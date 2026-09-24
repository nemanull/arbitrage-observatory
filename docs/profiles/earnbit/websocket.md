# EarnBIT WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:37 to 05:02 UTC on 2026-09-23, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare `loc=CA`, edges `SEA` and `YVR`).

This profile covers the public WebSocket of EarnBIT (no CCXT class) for its spot market, since EarnBIT lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs), and the capture is quoted beside the documented value.
The protocol is the JSON-RPC style of the ViaBTC exchange server family, `{"method", "params", "id"}`, with `depth.update` pushes whose first parameter says whether the frame is a full book.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot | `ws.earnbit.com` in S2, and `wss://ws.earnbit.com/` as `WS_URL` in the web bundle, S6 | open in 483 to 546 ms over three `book` runs and 469 to 601 ms for 26 sockets in each of three `batch` runs, answered 101 through Cloudflare |
| perpetuals, futures, margin | none | no URL exists, and `ws-futures.earnbit.com`, `futures.earnbit.com` and `api-futures.earnbit.com` do not resolve, see [`rest.md`](./rest.md) section 1 |

One URL carries every spot market.
`ws.earnbit.com` resolved to the same two Cloudflare addresses as the REST host.

## 2. Channel matrix for public market data

| channel | subscribe params | depth and speed | probed over three 60 s runs |
|---|---|---|---|
| `depth.subscribe`, pushes `depth.update` | `[market, limit, interval]`, as `["BTC_USDT", 100, "0"]` | limit 1, 5, 20, 50 or 100, interval `"0"` or `"0.1"` on `BTC_USDT`, pushed on a one second tick | a full book then deltas, section 4 |
| `depth.query` | `[market, limit, interval]` | one reply | answers `result` `{asks, bids}` |
| `price.subscribe`, pushes `price.update` | a list of markets, all 26 in one frame | last price on change | 21 to 24 of 26 markets sent one or more, 1 to 247 frames per market |
| `state.subscribe`, pushes `state.update` | a list of markets, all 26 in one frame | 24 h statistics on change | all 26 markets, 1 to 307 frames per market |
| `deals.subscribe`, pushes `deals.update` | a list of markets | trades | 59 to 175 frames on each of `BTC_USDT` and `ETH_USDT`, the first frame a batch of recent trades |
| `kline.subscribe` | market and interval | candles | not probed |
| `server.ping`, `server.time` | `[]` | one reply | `"pong"`, and Unix seconds |
| best bid and ask, mark, index, funding | none | | no such channel exists |

The method names and parameters are from S2 to S4.
No channel carries a mark, an index or a funding rate, because the venue has no derivative.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S2 | one URL for all 26 spot markets |
| subscribe frame shape | `{"method":"depth.subscribe","params":["BTC_USDT",1,"0"],"id":1}`, one market per call, S3 | as documented. A second `depth.subscribe` on the same socket replaces the first: `BTC_USDT` stopped and `ETH_USDT` started, in all three `book` runs. `state`, `price` and `deals` take a list of markets |
| unknown symbol expectation | not documented | `NOPE_USDT` and the lowercase `btc_usdt` are acknowledged as success and get one empty full book, `[true,{},"NOPE_USDT"]`, then nothing |
| chunk unit and budget | Not publicly specified | one depth stream per socket, so the unit is a socket. 26 sockets from this host were all accepted, three times |
| keepalive mechanism | `server.ping` answered by `"pong"`, S4. "The connection will be closed by the server in case of inactivity from the client after 60 seconds.", S2 | no server protocol ping on any socket. `server.ping` every 20 s kept a socket open for 100 s whether it was subscribed or not, in two runs. Protocol pings are answered but did not reliably keep a socket open, section 5 |
| connection lifetime and maintenance notice | not documented | no forced close in 100 s, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 26 sockets opened one after another, and no refusal at 22 requests sent 2.5 s apart on one socket |
| public market data authentication | none, S2 | none |
| message parse and routing | `{"id": null, "method": "depth.update", "params": [status, {asks, bids}, market]}`, S3 | as documented. Route on `method`, then on `params[2]` for depth and on `params[0]` for state, price and deals. Replies carry the request `id` and no `method` |
| subscribe acknowledgement shape | `{"id":1,"params":[],"result":{"status":"success"},"error":null}`, S3 | identical, and the full book arrives in the same millisecond as the ack or 1 ms after it |
| symbol identifier format | `BTC_USDT` | identical to the REST `markets` `name`, `symbols` and `tickers` keys on 26 of 26 markets |
| number representation | prices and amounts as strings, S3 | strings in depth, state, price and deals. `deals.update` sends `time` as a JSON number in seconds with a fraction, as `1.790138674365E9` |
| timestamp representation | none in depth | `depth.update` carries no timestamp at all, so a feed stamps on arrival |
| size unit | "Order amount (in 1st ticker of the pair)", S3 | base currency units, equal to the REST book amounts at the same price, section 4 |
| sequence semantics | none documented | none on the wire. No update id, no checksum, no timestamp |
| idle repeat behaviour | the doc names the first parameter "status" with "FALSE = returned latest result, TRUE = no updates", S3 | the first parameter is `true` for a full book and `false` for a delta. A quiet market sends nothing, and 3 or 4 of 26 markets sent 0 deltas in 45 s. One identical delta repeated once on `LTC_BTC` in the first run |

The documented meaning of the first parameter is wrong on the wire.
The first `depth.update` after every subscribe had `true` and held the whole book, and every later frame with `false` held only changed levels.

## 4. The book channel in detail

`depth.subscribe` with `[market, 100, "0"]` is the shape this profile records, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for a subscription is `params[0] === true` with 100 asks and 100 bids.
On `BTC_USDT`, `ETH_USDT` and `LTC_BTC` it arrived 147 to 166 ms after the subscribe frame was sent and 631 to 713 ms after the socket was created, in three runs.

### The full book every minute

A further full book arrives for every subscription at the top of each wall clock minute.
In the `session` rerun the two subscribed sockets got it at 04:59:00.071 and 04:59:00.083, then at 05:00:00.071 and 05:00:00.083 UTC.
The three `book` runs saw it 3.5 to 4.6 s, 24.5 to 25.5 s and 20.6 to 21.6 s after their sockets opened, which is 04:38:00, 04:45:00 and 04:56:00 UTC.
In the second and third runs every level of that full book equalled the book kept from the deltas, 200 of 200 on all three markets.
So it is a resend, and a feed resets on every `true` frame, not only the first.

### Delta semantics

A delta is `params[0] === false` with `asks` and `bids` arrays of `[price, amount]` string pairs.
An amount of `"0"` deletes the level, and every deleted price was present in the kept book, 0 unknown deletes over three runs.
No delta was empty, though one side can be an empty array.
A delta carried 1 to 292 entries, median 6 to 12 on `BTC_USDT` and `ETH_USDT` and 4 on `LTC_BTC`, and the large ones replace a whole side when the market maker moves its ladder.
A delta is not bounded by the subscribed limit: one delta on a `limit 20` subscription carried 200 bid entries, and one on a `limit 50` subscription carried 200 ask entries.
At limit 100 the kept book never held more than 100 levels a side, and it ended with 96 to 100.

### Sequence and gap rule

```text
params[0] = true    replace the book
params[0] = false   merge levels by price, amount "0" deletes
```

There is no update id, so a lost or reordered frame cannot be detected.
TCP order is the only guarantee, and the full book at each minute repairs any drift.
The kept book crossed 0 times, and its top 20 levels equalled the REST book on both sides of all three markets at the end of all three runs.
The REST touch read once a second beside the socket equalled the socket's touch on 51 of 51 reads and 52 of 52 reads in the second and third runs.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| full book | ascending, worst first and best last, on 3 of 3 markets in three runs | ascending, best first |
| delta | ascending on every delta with two or more bids, 128 of 128 and 88 of 88 in the second and third runs | ascending on every delta with two or more asks, 94 of 94 and 75 of 75 |
| REST `depth/result` | ascending, best last | ascending, best first |

A feed applies levels by price and never by position, which is what the engine's `OrderBook.reset` and `setBid` already do.

### Cadence

| market | frames in 60 s | gap between frames, median | p90 | max | touch changes in 60 s |
|---|---:|---:|---:|---:|---:|
| `BTC_USDT` | 53 to 59 | 1,001 ms | 1,007 to 2,001 ms | 3,009 to 6,004 ms | 11 and 18 |
| `ETH_USDT` | 48 to 51 | 1,001 ms | 2,001 to 2,003 ms | 5,001 to 9,061 ms | 14 and 19 |
| `LTC_BTC` | 11 to 40 | 1,001 to 8,005 ms | 3,000 to 12,211 ms | 9,009 to 12,211 ms | 9 and 36 |

The medians sit on a one second tick, with a few frames closer together, down to 28 ms apart.
In three `batch` runs, 3 or 4 markets among `USDC_USDT`, `USDQ_USDT`, `USDG_USDT`, `TRX_USDT` and `IMX_USDT` sent no delta in 45 s.

### Size unit

The amount is in base currency, "Order amount (in 1st ticker of the pair)", S3.
On the three markets the top 20 socket amounts equalled the REST `depth/result` amounts at the same price, 20 of 20 per side, so the unit is the same as REST's, see [`rest.md`](./rest.md) section 5.
A spot market has no contract size.

### Who is in the book

Every order on each side of every market is a zero fee order, see [`fees.md`](./fees.md) section 5.
EarnBIT's mid equalled Bybit's spot mid on 9 to 16 of the 24 markets both list, read in one parallel round, and sat within 451 to 649 ppm on the rest, see [`rest.md`](./rest.md) section 4.
The book is a market maker's ladder quoted around Bybit's price and pushed on a one second tick.

### One-sided and empty books

No one-sided book was seen on any of the 26 markets.
An unknown market gets an empty full book `{}` with neither key.
A feed that treats a missing `asks` or `bids` key as an empty side handles both.

### Unknown, closed and wrong symbols and parameters

| request | reply | then |
|---|---|---|
| `["NOPE_USDT", 20, "0"]` | `{"id":1,"params":[],"result":{"status":"success"},"error":null}` | one `[true,{},"NOPE_USDT"]`, then nothing |
| `["btc_usdt", 20, "0"]` | success | one `[true,{},"btc_usdt"]`, then nothing |
| limit `0`, `200`, `1000` or `"abc"` | `{"id":3,"params":["BTC_USDT",200,"0"],"result":null,"error":{"code":1,"message":"invalid argument"}}` | the previous subscription keeps delivering |
| interval `"1"`, `"10"` or `"abc"` on `BTC_USDT` | code 1 `invalid argument` | as above |
| interval `"0.1"` on `BTC_USDT` | success | a 20 level full book, the same prices as interval `"0"` because the price step of `BTC_USDT` is 0.1 |
| `depth.subscribe` with `[]` | code 1 `invalid argument` | |
| unknown method `nope.method` | no reply, in four runs | |
| text that is not JSON | no reply | the socket stays open and answers the next `server.ping` |
| `depth.unsubscribe` with `[]` | success | |

The documentation lists "method not found" among the general errors, S2, but the server sent nothing for an unknown method.
A closed or delisted market was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"method":"server.ping","params":[],"id":1}`, answered `{"id":1,"params":[],"result":"pong","error":null}`, S4 | pong in 146 to 167 ms, and no server ping frame on any socket |
| silence the server tolerates | "closed by the server in case of inactivity from the client after 60 seconds", S2 | an unsubscribed socket that sent nothing closed at 60.6 s and 60.5 s with 1006 and no close frame, in two runs. A subscribed socket that sent nothing closed at 82.8 s with 1000 in the first run and was still open at 100 s in the second. A socket that sent only protocol pings every 20 s closed at 81.2 s with 1000 in the first run and was still open at 100 s in the second. Sockets sending `server.ping` every 20 s stayed open for the full 100 s in both runs, subscribed or not |
| forced disconnect | not documented | none in 100 s |
| maintenance notice | not documented | none seen |
| compression | not documented | text JSON frames when deflate is not offered. When a client offers it, the server answers `permessage-deflate;client_max_window_bits=15`, twice, so it negotiates but does not force compression |
| handshake | | 469 to 601 ms to open from this host |
| subscription limits | one depth subscription per socket, implied by `depth.unsubscribe` taking no market, S3 | confirmed by the replacement in section 3 |
| throughput | | 26 sockets, one market each at limit 100, counted for 45 s after the last socket opened: 514 frames, median 12 frames per second, p90 15, peak 28, 4,838 bytes per second, 424 bytes per frame, 22 µs `JSON.parse` per frame |

The server's inactivity rule counts client requests, since only the sockets that sent `server.ping` were safe in both runs.
Inbound depth traffic and protocol pings did not reliably reset it, so a feed must send `server.ping`.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Depth arrays keep their first three asks and last three bids, and the trades frame keeps its first trade.

Subscribe and acknowledgement.

```json
{"method": "depth.subscribe", "params": ["BTC_USDT", 100, "0"], "id": 1}
```

```json
{"id":1,"params":[],"result":{"status":"success"},"error":null}
```

Full book, 100 levels a side on the wire, with bids ascending so the best bid is last.

```json
{"id":null,"method":"depth.update","params":[true,{"asks":[["87179.4","0.010727"],["87180.1","0.000702"],["87180.6","0.000954"]],"bids":[["87177.6","0.000602"],["87179","0.000361"],["87179.1","0.133606"]]},"BTC_USDT"]}
```

Deltas, one with an empty side and one that moves the touch.

```json
{"id":null,"method":"depth.update","params":[false,{"asks":[["87193.4","0.011995"],["87202.4","0"]],"bids":[]},"BTC_USDT"]}
```

```json
{"id":null,"method":"depth.update","params":[false,{"asks":[["87179.4","0"],["87180.1","0"],["87181.9","0.000992"]],"bids":[["87179.4","0.006694"],["87179.7","0.000035"],["87180.3","0.113902"]]},"BTC_USDT"]}
```

Keepalive and server time.

```json
{"id":5,"params":[],"result":"pong","error":null}
```

```json
{"id":6,"params":[],"result":1790139739,"error":null}
```

Errors.

```json
{"id":3,"params":["BTC_USDT",200,"0"],"result":null,"error":{"code":1,"message":"invalid argument"}}
```

```json
{"id":null,"method":"depth.update","params":[true,{},"NOPE_USDT"]}
```

State, price and trades.

```json
{"id":null,"method":"state.update","params":["BTC_USDT",{"period":86400,"last":"87179.3","open":"86204.3","close":"87179.3","high":"87285.7","low":"86140.2","deal":"160623.6911605","volume":"1.85392","change":"1.13"}]}
```

```json
{"id":null,"method":"price.update","params":["BTC_USDT","87180.4"]}
```

```json
{"id":null,"method":"deals.update","params":["BTC_USDT",[{"id":12452896403,"type":"buy","time":1.790138674365E9,"price":"87179.3","amount":"0.000018"}]]}
```

## 7. Private channels

Named for a future execution stage, from S5, not probed.
They use the same URL after `server.auth`.

- `server.auth`, then `asset.query`, `asset.subscribe` and `asset.unsubscribe` for balances.
- `order.query`, `order.history`, `order.subscribe` and `order.unsubscribe` for orders.
- Order entry is REST only, `POST /api/v1/order/new` and `POST /api/v1/order/cancel`, with balances and history under `/api/v1/account/`, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
EarnBIT is spot only, so the engine, which takes perpetual legs, has no use for this feed today, and this shape is recorded only for completeness.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.earnbit.com/`, one socket per market | a second `depth.subscribe` replaces the first |
| channel | `depth.subscribe` with `[rawMarketId, 100, "0"]` | 100 is the largest accepted limit and the whole ladder the market maker shows |
| markets per connection | 1 | as above, 26 sockets for the whole catalog |
| subscribe frames | one per socket, `{"method":"depth.subscribe","params":["BTC_USDT",100,"0"],"id":1}` | |
| keepalive | `{"method":"server.ping","params":[],"id":<n>}` every 20 s | only client requests reliably reset the server's inactivity timer, and a 20 s ping held sockets open for 100 s in both runs |
| `maxSilenceMs` | 60,000 | three missed pongs, since a quiet market sends no delta for 45 s or more and the pong is the only guaranteed traffic |
| routing | `params[2]` of `depth.update` is the `rawMarketId` | |
| snapshot | `params[0] === true`: `resetBook` with both sides, a missing key being an empty side | the full book at each minute replaces the book too |
| delta | `params[0] === false`: `setBid` and `setAsk` per level, `"0"` deletes, then `publish` | |
| resync | none is detectable, so reconnect on socket close or silence only | there is no sequence, checksum or timestamp |
| unserved stream | log a market whose first full book is empty | unknown markets are acknowledged with an empty book |
| receive time | stamp on arrival | the frame carries no time |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when offered |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | EarnBIT API, Private endpoints, HTTP | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/private-endpoints-or-http.md | 2026-09-22 | EarnBIT, global | private REST paths, section 7 |
| S2 | EarnBIT API, Basic structure and Public methods, WebSocket | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/basic-structure-or-websoket.md | 2026-09-22 | EarnBIT, global | endpoint, request shape, 60 s inactivity rule, general errors, sections 1, 3, 4, 5 |
| S3 | EarnBIT API, Depth methods | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/public-methods-or-websoket/depth-methods.md | 2026-09-22 | EarnBIT, global | `depth.query`, `depth.subscribe`, `depth.update` and its documented status meaning, sections 2 to 5 |
| S4 | EarnBIT API, Ping-Pong and System Time | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/public-methods-or-websoket/ping-pong.md | 2026-09-22 | EarnBIT, global | `server.ping`, `server.time`, sections 2, 3, 5 |
| S5 | EarnBIT API, Private methods, WebSocket | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/private-methods-or-websoket.md | 2026-09-22 | EarnBIT, global | private method names, section 7 |
| S6 | EarnBIT web app bundle | https://earnbit.com/_nuxt/d6d52ea.js | 2026-09-22 | Earnbit LLC | `WS_URL`, section 1 |
| P1 | `ws-probe.mjs book`, three runs at 04:37, 04:44 and 04:55 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 4 and 6 |
| P2 | `ws-probe.mjs batch`, three runs at 04:39, 04:57 and 05:00 UTC, the last with counters that start after every socket opened | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 3, 4, 5 |
| P3 | `ws-probe.mjs session`, two runs at 04:40 and 04:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the full book each minute, section 5 |
| P4 | `ws-probe.mjs deflate`, two runs at 04:40 and 04:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P5 | `ws-probe.mjs errors` at 05:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the error frames, sections 4 and 6 |
| P6 | `rest-probe.mjs main`, four runs | [`rest-probe.mjs`](../../../scripts/probes/venues/earnbit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the Bybit mid comparison and the fee scan, section 4 |
