# Azbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:20 and 03:51 UTC on 2026-09-23.

This profile covers the public futures WebSocket of Azbit, which has no CCXT class, for its one perpetual family, USDT-margined linear contracts, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs), and the capture is quoted beside the documented value.
The documentation is the OpenAPI reference at `https://data.azbit.com/swagger/v1/swagger.json`, S1, and the pages at `https://docs.azbit.com/docs/websockets/`, S2, and the two disagree in places.
The main finding is in section 4: every Azbit futures book frame probed was a top of book state that Bybit's public linear socket had already sent, a median of 90 to 168 ms earlier over two runs.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, book | `wss://ws.azbit.com/futures/orderbooks-snapshots`, S1 | 101, open in 613 to 753 ms |
| USDT-M perpetuals, trades | `wss://ws.azbit.com/futures/latest-price`, S1 | not probed |
| USDT-M perpetuals, 24 h ticker | `wss://ws.azbit.com/futures/market24`, S1 | not probed |
| USDT-M perpetuals, candles | `wss://ws.azbit.com/futures/market`, S1 | not probed |
| liveness | `wss://ws.azbit.com/ping`, S1, S2 | 101, answers `{"Result":"pong"}` |
| server time | `wss://ws.azbit.com/time`, S2 only | HTTP 404 at the handshake, so the route does not exist |
| spot | `/orderbooks-snapshots`, `/orderbooks-changes`, `/latest-price`, `/market`, `/market24` on the same host, S1 | out of scope, see [`fees.md`](./fees.md) section 3 |

"The channel is chosen by the path you connect to, not by a field in a frame, so a client following two channels opens two sockets", S1.
There is one perpetual family, so one book URL serves every perpetual.
`ws.azbit.com` resolved to the Cloudflare addresses `172.67.71.46`, `104.26.4.121` and `104.26.5.121`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe frame | depth and speed | probed |
|---|---|---|---|
| `/futures/orderbooks-snapshots` | `{"Method":"subscribe","CurrencyPairs":["BTCUSDT"]}` | "at most 20 levels per side, and is pushed at most every 500 ms per pair", S1 | 20 levels per side on every frame, a median of 290 to 382 ms between frames on busy contracts, section 4 |
| `/futures/latest-price` | same | on trade | not probed |
| `/futures/market24` | same | "pushed on the exchange ticker interval", S1, carries `price`, 24 h figures and `currencyPairCode` | not probed |
| `/futures/market` | `{"Method":"subscribe","Params":["BTCUSDT",60]}` | candles | not probed |
| delta book channel | none: "Futures has no delta channel: re-read this snapshot each time", S1 | | |
| best bid and ask | none | | |
| mark, index, funding | none | | |

No channel carries a mark, an index or a funding rate.
The 24 h ticker's documented fields are price and volume only, S1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one path per channel on one host, S1 | one socket per channel, the one perpetual family shares it |
| subscribe frame shape | `{"Method":"subscribe","CurrencyPairs":[...]}`, and "Params is accepted as a synonym for CurrencyPairs on every channel", S2 | 161 pairs in one frame got one `{"Result":"Subscribed"}` and 158 of them delivered. `Params` in place of `CurrencyPairs` worked |
| unknown symbol expectation | Not publicly specified | `NOPEUSDT`, `BTC_USDT` and an empty list each answered `{"Result":"Subscribed"}` and then sent nothing |
| chunk unit and budget | Not publicly specified | 161 pairs in one frame on one socket, no refusal |
| keepalive mechanism | "The server sends a WebSocket ping every 120 seconds", S2. `/ping` answers `{"Params":["ping"]}` with `{"Result":"pong"}`, S1 | no server ping on any socket in 120 s. A client protocol ping gets a pong. On the book route the text ping gets no reply |
| connection lifetime and maintenance notice | Not publicly specified | no forced disconnect in 120 s, no notice seen |
| handshake and operation rate limits | Not publicly specified for sockets. REST is 5 requests per second per endpoint, S3 | no refusal at seven sockets opened within 12 s in the session mode |
| public market data authentication | none, "Public: no key, no signature", S1 | none |
| message parse and routing | a book frame is `{currencyPairCode, asks, bids}`, S1 | routes on `currencyPairCode`. Control frames carry `Result` and no `currencyPairCode` |
| subscribe acknowledgement shape | `{"Result":"Subscribed"}`, S2 | same, 157 to 188 ms after the frame was sent. Unsubscribe answers `{"Result":"Unsubscribed"}` |
| symbol identifier format | "Pair codes have no underscore", `BTCUSDT`, S1 | `BTCUSDT` as in the REST pairs call. The index pair is spelled `$BTC_TOP`, with an underscore, and it delivers |
| number representation | `{"price": 64181.0, "quantity": 0.7}`, S1 | JSON numbers, printed with the pair's precision, as `2768.60` |
| timestamp representation | none in the book frame, S1 | none. A frame carries no time and no id |
| size unit | Not publicly specified | base asset, as Bybit's book, section 4 |
| sequence semantics | none: "Each frame replaces the whole client book", S1 | none. No sequence field exists, so a gap cannot be seen |
| idle repeat behaviour | Not publicly specified | 0 to 14 frames per 60 s were byte identical to the previous frame of the same pair. A quiet pair went up to 23.7 s without a frame |

## 4. The book channel in detail

### Snapshot on subscribe

Every frame is a whole book of 20 levels per side, and the first arrived 188 and 273 ms after the subscribe frame was sent in the two book runs.
On a socket of 161 pairs, the first frame per pair came a median of 598 and 588 ms after subscribing, a p90 of 4,608 and 2,983 ms and a maximum of 19,881 and 16,914 ms in two runs, so a quiet pair's first book waits for its first change.

### Delta semantics

There are none.
"Each frame replaces the whole client book", S1, so a feed calls `resetBook` on every frame.

### Sequence and gap rule

No frame carries a sequence, an update id or a time, so a lost frame and a stale book are both invisible to the client.
The next frame repairs a lost one, because it replaces the whole book.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket frame | descending, best first, on every frame of the five pairs that delivered, in two 60 s runs | ascending, best first |
| REST `GET /api/futures/trade/orderbook/{code}` | descending, 50 levels | ascending, 50 levels |

The wire sends `asks` before `bids` in the object.

### Cadence

Two 60 s runs, at 03:27 and 03:45 UTC, each value written as first run and rerun.

| pair | frames | interval min, ms | interval median, ms | interval p90, ms | interval max, ms | byte identical to the previous frame |
|---|---|---|---|---|---|---|
| `BTCUSDT` | 171, 176 | 112, 112 | 356, 364 | 581, 549 | 799, 726 | 14, 2 |
| `ETHUSDT` | 169, 175 | 113, 39 | 364, 382 | 602, 548 | 872, 667 | 6, 2 |
| `AVAXUSDT` | 164, 178 | 112, 117 | 373, 290 | 599, 535 | 943, 597 | 2, 0 |
| `EURUSD` | 105, 98 | 203, 152 | 554, 603 | 803, 859 | 973, 1,170 | 1, 3 |
| `$BTC_TOP` | 215, 214 | 0, 0 | 271, 265 | 493, 436 | 606, 595 | 3, 2 |
| `FIOUSDT` | 0, 0 | | | | | |

The documentation says "at most every 500 ms per pair", S1, and the wire sent frames as close as 39 ms apart on `ETHUSDT` and 112 ms on `BTCUSDT`.
On one socket of all 161 pairs, the per pair median interval was itself a median of 535 and 500 ms in two 45 s runs.
The longest gap per pair was a median of 3,056 and 2,181 ms, a p90 of 9,772 and 6,594 ms, and a maximum of 23,704 and 15,979 ms.
The quietest pairs were `APRUSDT` with 8 frames in 45 s and `LPTUSDT` with 19.

### The book is Bybit's

The probe kept Bybit's public `orderbook.50` book for `BTCUSDT`, `ETHUSDT` and `AVAXUSDT` from `wss://stream.bybit.com/v5/public/linear` beside the Azbit socket, and stamped each Bybit top five state on its first arrival.

| pair | Azbit frames | frames whose top five bids and asks equalled a Bybit state | lag behind Bybit's first arrival of that state, ms |
|---|---|---|---|
| `BTCUSDT`, run 1 | 171 | 171 | min 76, median 168, p90 483, max 968 |
| `ETHUSDT`, run 1 | 169 | 169 | min 26, median 140, p90 329, max 833 |
| `AVAXUSDT`, run 1 | 164 | 164 | min 43, median 151, p90 519, max 1,463 |
| `BTCUSDT`, run 2 | 176 | 176 | min 39, median 112, p90 210, max 625 |
| `ETHUSDT`, run 2 | 175 | 175 | min 40, median 107, p90 188, max 456 |
| `AVAXUSDT`, run 2 | 178 | 178 | min 7, median 90, p90 143, max 275 |

Every frame matched to the size, to five levels per side, and none matched a state Bybit had not yet sent.
The REST book agrees: in the first run `AVAXUSDT` had all 20 of its top bid levels equal to Bybit's REST book read at the same instant, and in the rerun `SHIB1000USDT` had all 20, see [`rest.md`](./rest.md) section 2.
The three pairs that Bybit does not list, `IPUSDT`, `FIOUSDT` and `VINEUSDT`, are listed as active on Azbit and sent no frame on the socket.
So the Azbit perpetual book is Bybit's book, republished about 90 to 170 ms later at the median from this host, and not a book of its own.
Both arrival times are read on this host's clock, and the two sockets reach different servers over different paths, so part of the lag may be network path rather than Azbit's own delay.

### Size unit against the catalog

`quantity` is in the base asset, as Bybit reports it.
`AVAXUSDT` showed 106 at a best bid of 11.287 on both venues' REST books at one instant, where Bybit's size is in AVAX, and the pairs call gives `contractValue` 0.1, so a quantity of 106 is 106 AVAX and not 106 contracts.
CCXT has no class, so no `contractSize` exists to compare, and a catalog built by hand would need a contract size of 1 for the book to read correctly.
`contractValue` equals `lotSize` on 160 of 161 contracts, all but `$BTC_TOP`, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

No probed frame had an empty side, and no book was crossed.
The three pairs with no book on Bybit never sent a frame, so an empty book is not pushed at all.

### Unknown, closed and wrong spelling symbols

| request | reply | then |
|---|---|---|
| `{"Method":"subscribe","CurrencyPairs":["NOPEUSDT"]}` | `{"Result":"Subscribed"}` | nothing |
| `BTC_USDT`, the spot spelling | `{"Result":"Subscribed"}` | nothing |
| empty list | `{"Result":"Subscribed"}` | nothing |
| `{"Method":"nope","CurrencyPairs":["BTCUSDT"]}` | nothing | socket stays open |
| `hello`, not JSON | nothing | socket stays open |
| `SOLUSDT` twice | a second `{"Result":"Subscribed"}` | one stream continues |
| `{"Method":"unsubscribe","CurrencyPairs":["SOLUSDT","XRPUSDT"]}` | `{"Result":"Unsubscribed"}` 168 and 162 ms later | frames already in flight still arrive, 46 to 51 ms after the unsubscribe was sent, before the acknowledgement |

A feed has to notice a pair that never sends a frame on its own, because the acknowledgement does not distinguish it.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 120 s, S2 | no server ping on any socket over 120 s, in three runs. A client protocol ping every 20 s got 3 pongs in 75 s, in two runs |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 60.6 s, 60.7 s and 60.7 s in three runs, code 1006 and no close frame. A protocol ping every 20 s, or the text `{"Params":["ping"]}` every 20 s, kept a socket open to 75 s |
| forced disconnect | Not publicly specified | none in 120 s on a subscribed socket |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | public routes need no key | 613 to 753 ms to open from this host |
| subscription limits | Not publicly specified | 161 pairs on one socket, all acknowledged |
| throughput | | all 161 pairs on one socket for 45 s, two runs: 11,023 and 12,820 frames, a median of 240 and 289 frames per second, peaks of 313 and 360, 352 and 410 KB per second, 1,473 and 1,472 bytes per frame, 18 and 21 µs `JSON.parse` per frame |
| `/ping` route | `{"Params":["ping"]}` answers `{"Result":"pong"}`, S1. The docs page shows `{"Params": "ping"}`, S2 | the array form answered in 164 and 159 ms in two runs, the string form got no reply |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe.

```json
{"Method":"subscribe","CurrencyPairs":["BTCUSDT","ETHUSDT","AVAXUSDT","EURUSD","FIOUSDT","$BTC_TOP"]}
```

Acknowledgement, the same for a known pair, an unknown pair and an empty list.

```json
{"Result":"Subscribed"}
```

Book frame, first three levels per side kept.
It is the first frame of the book run, 188 ms after the subscribe frame.

```json
{"currencyPairCode":"ETHUSDT","asks":[{"price":2768.46,"quantity":116.63},{"price":2768.47,"quantity":0.02},{"price":2768.48,"quantity":9.35}],"bids":[{"price":2768.45,"quantity":3.87},{"price":2768.43,"quantity":0.01},{"price":2768.42,"quantity":0.02}]}
```

Unsubscribe acknowledgement.

```json
{"Result":"Unsubscribed"}
```

Keepalive on the `/ping` route.

```json
{"Params":["ping"]}
```

```json
{"Result":"pong"}
```

No error frame exists on the book route: an unknown method and text that is not JSON get no reply at all.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They are paths on the same host, and the handshake is signed with `API-PublicKey` and `API-Signature` headers and a `timestamp` query parameter within 30 s of server time.

- `/futures/user-orders` and `/futures/user-deals` for futures orders and fills, `/user-orders` and `/user-deals` for spot, and `/user-balances`.
- A refusal "arrives as an ordinary HTTP status, 401, 403 or 503", and events missed while a socket is down are not queued, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and the recommendation is not to build it, because the book is Bybit's, see section 4.
If a feed were ever built, it would look like this.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.azbit.com/futures/orderbooks-snapshots` | one perpetual family |
| markets per connection | all, up to 161 | 161 pairs ran on one socket at a median of 240 and 289 frames per second |
| subscribe frames | one frame, `{"Method":"subscribe","CurrencyPairs":["BTCUSDT", …]}` | acknowledged once for the whole list |
| keepalive | protocol ping every 20 s | the server sent no ping, a socket with no traffic dies at about 60 s, and the pong counts as traffic in `VenueFeed` at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 98 |
| `maxSilenceMs` | 45,000 | two missed pongs, and a quiet pair can go 23.7 s without a frame, so only the pong keeps a socket of quiet pairs visibly alive |
| routing | `currencyPairCode` is the `rawMarketId` | the pairs call spells it the same way |
| snapshot | every frame: `resetBook` with the 20 levels | "Each frame replaces the whole client book" |
| delta | none | |
| resync | none possible from the frame | no sequence exists. Only a pair that stays silent can be flagged |
| unserved pair | log a pair with no frame 30 s after the acknowledgement | unknown pairs and pairs with no Bybit book are acknowledged and silent |
| receive time | stamp on arrival | the frame has no time |
| sizes | base asset, contract size 1 | section 4 |
| depth | 20 levels, which is the engine's `depthLevels` default at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61 | the channel's maximum |
| deflate | keep `perMessageDeflate: false`, [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Azbit PublicApi reference, OpenAPI v1, sections "WebSockets" and the `/futures/*`, `/ping` and private socket paths | https://data.azbit.com/swagger/v1/swagger.json | 2026-09-22 | AZ Strategic Ltd, global | routes, subscribe frames, 20 levels, 500 ms, no delta channel, private channel signing, sections 1 to 7 |
| S2 | Azbit docs, Socket API pages "Websocket Introduction", "Orderbook snapshots", "Ping", "System time" | https://docs.azbit.com/docs/websockets/intro/ | 2026-09-22 | AZ Strategic Ltd, global | `Params` synonym, unsubscribe, 120 s server ping, `/time` route, string `Params` ping, sections 1, 3 and 5 |
| S3 | Azbit docs, "Spot Limits" | https://docs.azbit.com/docs/spot/limits/ | 2026-09-22 | AZ Strategic Ltd, global | 5 requests per second, section 3 |
| P1 | `ws-probe.mjs book`, runs at 03:27 and 03:45 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs) | 2026-09-22 | this host | cadence, levels, order, Bybit lag, error cases, sections 3, 4 and 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:29 and 03:46 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs) | 2026-09-22 | this host | 161 pairs on one socket, throughput, silent pairs, sections 3 to 5 |
| P3 | `ws-probe.mjs session`, runs at 03:33, 03:37 and 03:48 UTC on 2026-09-23, the first with the earlier two socket version of the mode | [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs) | 2026-09-22 | this host | silence, keepalive, `/ping` and `/time`, section 5 |
| P4 | `ws-probe.mjs deflate`, runs at 03:26 and 03:50 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/azbit/ws-probe.mjs) | 2026-09-22 | this host | compression, section 5 |
