# BigONE WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:19 to 04:40 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocated to Canada (Cloudflare trace `loc=CA`, colo `YVR`).

This profile covers the public contract WebSocket v2 of BigONE (CCXT id `bigone`) for both perpetual families, with the book channel in detail.
CCXT 4.5.68 has no Pro class for BigONE, so there is no CCXT socket code to compare against.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The contract socket subscribes by URL, one channel and one symbol per connection, and the documentation publishes a limit of 5 WebSocket connections per user.
No probe held more than four sockets at once, so whether the venue accepts one socket per perpetual is not known, see section 5.

## 1. Endpoints

| family or use | documented URL | probed |
|---|---|---|
| USDT-M and coin-M book | `wss://api.big.one/ws/contract/v2/depth@{symbol}`, S1 | 101 for `BTCUSDT`, `ETHUSDT`, `DOGEUSDT`, `SQQQUSDT` and the inverse `BTCUSD`, opened in 172 to 581 ms |
| same, on CCXT's host | `wss://big.one/ws/contract/v2/depth@{symbol}` | 101, same frames |
| trades | `.../trades@{symbol}`, S1 | not probed |
| candlesticks | `.../candlesticks/{period}@{symbol}`, periods `1MIN` to `1D`, S1 | not probed |
| instruments | `.../instruments` for all, `.../instruments@{symbol}` for one, S1 | 101, the all-instruments socket opened in 247 and 195 ms |
| private stream | `.../stream` with `Authorization: Bearer <JWT>` on the handshake, S1 | not probed |
| base named on the introduction page | `wss://api.big.one/ws/v2`, S3 | 403 from the Akamai edge, "Access Denied", to a handshake without a subprotocol. The web app opens `/ws/v2` with the subprotocol `proto` for spot, S4 |
| undocumented, used by the web app | `wss://big.one/ws/contract/v3/realtime`, S4 | 101. Acknowledged the topics `instruments` and `trades`, and ignored `depth`, `orderbook`, `orderBook`, `book`, `depths` and `candlesticks` |

Both families share one URL scheme, and the symbol picks the family.
One socket carries exactly one channel for one symbol: "To watch a specific channel, you open a new connection to that specific URL. If you want to watch multiple markets, you open multiple connections.", S2.

## 2. Channel matrix for public market data

| channel | URL | depth and speed | probed |
|---|---|---|---|
| depth | `depth@{symbol}` | the whole book, pushed on change, no depth or speed option | snapshot then deltas. 1.3 to 1.8 frames per second on `BTCUSDT` and `ETHUSDT`, 0.1 to 0.3 on `DOGEUSDT` and `SQQQUSDT` |
| best bid and ask | none of its own | every depth frame carries `bestPrices` | `bestPrices` equalled the rebuilt book's touch on every frame of the three runs |
| trades | `trades@{symbol}` | on trade | not probed on v2. On v3, `BTCUSDT` trades arrived with `size` 2 to 130, which are contracts |
| candlesticks | `candlesticks/{period}@{symbol}` | on change | not probed |
| instruments, carrying index, mark and funding | `instruments` or `instruments@{symbol}` | on change | 1,514 frames in 30 s, and 1,336 in the second pass. The first frame held all 99 contracts, and later frames held 1 row each, at a median gap of 18 and 21 ms |
| mark, index or funding alone | none | | |

The instruments channel pushed 62 rows for `BTCUSDT` in 30 s, and those rows held only 7 distinct `indexPrice` values, and 50 rows with 6 values in the second pass.
So the socket repeats rows between index steps, and the index still moves about every 5 s, as on REST, see [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per channel and symbol, S1 and S2 | one depth stream per socket, for either family |
| subscribe frame shape | none, the URL is the subscription, S1 | a JSON subscribe frame `{"op":"subscribe","args":[{"topic":"depth","symbol":"BTCUSDT"}]}` got `{"pong":null}` and added no stream |
| unknown symbol expectation | "HTTP 400 Bad Request: Invalid parameters in the URL.", S1 | 400 with an empty body for `NOPEUSDT`, lowercase `btcusdt` and the disabled `EOSUSDT`. 204 for `depth` without a symbol and for an unknown channel `nope@BTCUSDT` |
| chunk unit and budget | one stream per connection, and "WebSocket Connections: 5 connections per user", S3 | four depth sockets open at once were all served. More was not tried |
| keepalive mechanism | Not publicly specified | no server ping on any socket, the longest held 120 s. A protocol ping was answered in 98 to 190 ms. A JSON text frame `{"ping":1}` was answered `{"pong":1}`, and non-JSON text was ignored |
| connection lifetime and maintenance notice | "If a connection is dropping or invalid after the handshake, the server will simply close the connection.", S1 | no close in 120 s on a silent client or a pinging one, and no notice channel exists |
| handshake and operation rate limits | the 5 connection figure above, S3 | contract v2 sockets opened in 172 to 581 ms, and no handshake for a valid symbol was refused |
| public market data authentication | none, S1 | none |
| message parse and routing | a bare JSON object per frame, S1 | the snapshot carries no `symbol` key on 12 of 12 streams over three runs, and every delta carries `symbol`. A feed routes by the connection |
| subscribe acknowledgement shape | none | none. The snapshot is the first frame, 1 to 50 ms after the socket opened |
| symbol identifier format | `BTCUSD`, `BTCUSDT`, S1 | identical to CCXT `market.id` and to the anchor rows, case sensitive |
| number representation | "Prices and Amounts: Returned as strings", S3 | prices are object keys and so strings, while sizes, `lastPrice` and `bestPrices` are JSON numbers |
| timestamp representation | milliseconds, S3 | a depth frame carries no timestamp at all |
| size unit | Not publicly specified for depth | contracts of `multiplier` coins, which is CCXT `contractSize`, and contracts of 1 USD on the inverse books, section 4 |
| sequence semantics | the example shows a snapshot with `to` 91277134 and a delta with `from` and `to` 91277135, S1 | `from` equals the previous frame's `to` on 291 of 291 deltas in the second run and 233 of 233 in the second pass, never `to` plus one. The ids are one sequence across all contracts |
| idle repeat behaviour | Not publicly specified | 0 identical frames. A quiet book sends nothing, for up to 28.3 s on `SQQQUSDT` |

## 4. The book channel in detail

### Snapshot on subscribe

The first frame on every depth socket is the whole book with `"from": 0`, on 12 of 12 streams over three runs, 1 to 50 ms after the socket opened.
No second snapshot came in 75 s on any stream.

### Delta semantics

A delta carries `from`, `to`, `symbol`, `lastPrice`, `bestPrices`, and `bids` and `asks` as maps of price to size.
A side with no change is `{}`, and 0 of 287 deltas in the first run, 0 of 291 in the second and 0 of 233 in the second pass had both sides empty.
A size of 0 deletes the level, and any other size replaces it.
That reading reproduced the venue's book exactly: at the end of the first run and of the second pass the book rebuilt from the snapshot and every delta equalled the REST snapshot taken at the same `to` on every level.

| contract | levels compared at equal `to`, each run | equal |
|---|---:|---:|
| `BTCUSDT` | 41 | 41 |
| `ETHUSDT` | 36 | 36 |
| `DOGEUSDT` | 24 | 24 |
| `SQQQUSDT` | 16 | 16 |

### Sequence and gap rule

```text
from = 0                      replace the book, last = to
from = last                   apply, last = to
from ≠ last, or no snapshot   gap: terminate and reopen the socket, whose first frame is a fresh snapshot
```

On the wire `from` equalled the previous `to` on 139 `BTCUSDT`, 124 `ETHUSDT`, 19 `DOGEUSDT` and 9 `SQQQUSDT` deltas, 291 of 291, and on 233 of 233 in the second pass.
The first run's 287 deltas, counted before the check was split, all had `from` at or below the previous `to`.
Every delta spans more than one id, up to 1,713 ids on `DOGEUSDT`, because the ids count events across all contracts.
The documented example, `from` equal to the previous `to` plus one, never occurred.
No gap was seen, so what the venue sends after a lost frame is Not verified.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | unordered, 12 of 12 streams | unordered, 12 of 12 |
| delta | mixed: single, empty, ascending, descending and unordered all occur | mixed |
| REST snapshot | unordered | unordered |

The order is that of a JSON object, so a feed reads keys as prices and never relies on position.
A parser has to read the price keys from the object and must not assume the order `JSON.parse` returns, since JavaScript lists integer-like keys such as `"86000"` first.

### Level window

There is none.
The socket and the REST snapshot both send the whole book, and it is thin.

| contract | bid levels over 75 s | ask levels over 75 s |
|---|---:|---:|
| `BTCUSDT` | 24 to 30 | 13 to 17 |
| `ETHUSDT` | 19 to 22 | 14 to 17 |
| `DOGEUSDT` | 16 | 8 |
| `SQQQUSDT` | 8 | 8 |

So many sides hold fewer than the engine's 20 levels, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61, and the feed simply hands over what exists.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | coins | notional |
|---|---:|---:|---:|---:|---:|
| `BTCUSDT` | 0.001 | 3,218 | 3,218 | 3.218 BTC | about 280,000 USDT |
| `ETHUSDT` | 0.1 | 299 | 299 | 29.9 ETH | about 83,000 USDT |
| `DOGEUSDT` | 1,000 | 105 | 105 | 105,000 DOGE | about 10,900 USDT |
| `SQQQUSDT` | 0.1 | 2,365 | 2,365 | 236.5 SQQQ | about 7,900 USDT |

The unit is contracts, and one contract is `multiplier` coins, which CCXT reports as `contractSize`, see [`rest.md`](./rest.md) section 2.
Trades on the v3 socket for `BTCUSDT` had sizes of 2 to 130, which fits contracts of 0.001 BTC and not whole bitcoin.
The engine's `sizeMul` therefore converts BigONE linear sizes correctly.

The inverse `BTCUSD` has `multiplier` 1 and showed 225,950 and 252,712 at the touch against a price near 86,870.
That is plausible as US dollars and impossible as bitcoin, so the engine would read it wrongly, and a linear-only `marketFilter` is needed.
This reading of the inverse unit is an inference.

### One-sided and empty books

None was seen.
The thinnest book probed, `SQQQUSDT`, held 8 levels a side throughout.
What the snapshot sends for an empty side is Not verified, and the engine's `resetBook` accepts one.

### Idle repeats

Nothing is repeated on the depth channel.
A quiet book sends no frame until it changes: the longest gaps were 28.3 s on `SQQQUSDT` and 26.4 s on `DOGEUSDT`.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `depth@NOPEUSDT` | handshake refused, HTTP 400, empty body |
| `depth@btcusdt` | 400, empty body |
| `depth@EOSUSDT`, a contract with `enable` false | 400, empty body |
| `depth@BTCUSD`, the inverse contract | 101 and a snapshot |
| `depth` with no symbol | 204 |
| `nope@BTCUSDT` | 204 |
| text `hello` or `ping` on an open socket | nothing, the socket stays open |
| any JSON object on an open socket | `{"pong": <value of its ping key, or null>}` |

The engine reopens a closed plan with exponential backoff and no attempt limit, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 356 to 373, so a contract that starts to answer 400 would be retried until the next restart.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | no server ping on any socket in up to 120 s. Protocol ping answered in 98 to 190 ms, five pings. `{"ping":1}` answered `{"pong":1}` |
| silence the server tolerates | Not publicly specified | a socket on `SQQQUSDT` whose client sent nothing stayed open for the full 120 s, with gaps between book frames of up to 28.2 s |
| forced disconnect | "the server will simply close the connection" when it is dropping or invalid, S1 | none in 120 s |
| maintenance notice | none | none |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | HTTP 101, or 400, 401 and 500 on failure, S1 | 172 to 581 ms to open, `server: envoy` |
| connection limit | "5 connections per user", S3 | four at once served. Whether an anonymous IP may open about 97, one per linear perpetual, is Not verified |
| throughput | | 1.3 to 1.8 frames and 248 to 372 bytes per second on `BTCUSDT`, and a median `JSON.parse` of 18 to 47 µs per frame across the four streams |

The connection limit is the question this profile could not settle within the survey's rule of staying inside published limits.
The figure sits on the general information page next to the REST limit of 500 requests per 10 s per IP, and it says "per user", while the public sockets carry no user.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Snapshot of `SQQQUSDT`, whole, with no `symbol` key.

```json
{"to":4298696753,"bestPrices":{"ask":33.35,"bid":33.3},"lastPrice":38.93,"bids":{"32.94":3076,"33.02":3057,"32.92":3054,"33.1":2276,"33.05":2257,"32.96":2999,"33.3":2353,"33.29":2442},"asks":{"33.67":3024,"33.77":3114,"33.97":3024,"33.38":2525,"33.37":2116,"33.36":2358,"33.71":3000,"33.35":1915},"from":0}
```

The first two deltas of `ETHUSDT`, where each `from` is the previous `to`, and the second has an empty bid side.

```json
{"symbol":"ETHUSDT","from":4298696626,"to":4298696785,"lastPrice":2780.38,"bestPrices":{"ask":2780.39,"bid":2780.38},"asks":{"2780.96":372},"bids":{"2780.38":260}}
```

```json
{"symbol":"ETHUSDT","from":4298696785,"to":4298696828,"lastPrice":2780.38,"bestPrices":{"ask":2780.39,"bid":2780.38},"asks":{"2780.39":289},"bids":{}}
```

Keepalive, a JSON text frame and its answer.

```json
{"ping": 1}
```

```json
{"pong":1}
```

Error: `wss://api.big.one/ws/contract/v2/depth@NOPEUSDT` is refused at the handshake with HTTP 400 and an empty body, so there is no frame to quote.

Instruments, one later row.

```json
[{"usdtPrice":0.99982659,"symbol":"HYPEUSDT","btcPrice":86945.16,"ethPrice":2779.98,"nextFundingRate":0.00005,"fundingRate":0.0001801,"latestPrice":96.98,"last24hPriceChange":0.0436,"indexPrice":96.995,"volume24h":956061,"turnover24h":91377207.604,"nextFundingTime":1790150400000,"markPrice":97.0108,"last24hMaxPrice":97.8,"volume24hInUsd":91361361.88242939,"openValue":4353.5115,"last24hMinPrice":92.58,"openInterest":45}]
```

The undocumented v3 socket, a subscribe and its acknowledgement.

```json
{"op": "subscribe", "args": [{"topic": "instruments", "symbol": "BTCUSDT", "gid": "1"}]}
```

```json
{"success":true,"requestId":"1","arg":{"symbol":"BTCUSDT","topic":"instruments","gid":"1"}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
One socket, `wss://api.big.one/ws/contract/v2/stream`, authenticated by `Authorization: Bearer <JWT>` on the handshake, pushes `cash`, `positions`, `orders` and `trades` in one object.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It depends on the connection limit of section 5, which has to be settled first, by asking BigONE or by a probe the user approves.

| item | recommendation | reason |
|---|---|---|
| URL plan | one `EndpointPlan` per market, `wss://api.big.one/ws/contract/v2/depth@<rawMarketId>`, 97 plans for the linear perpetuals | the URL is the subscription, and `EndpointPlan` already takes a URL per plan, at [`types.ts`](../../../server/src/feeds/book/types.ts) lines 4 to 8 |
| subscribe frames | `[]` | the engine sends nothing for an empty list, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 135 to 150 |
| markets per connection | 1 | fixed by the venue |
| keepalive | a protocol ping every 15 s | the server sends none, and a pong refreshes the silence clock, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 98 |
| `maxSilenceMs` | 45,000 | three missed pongs. A quiet book went 28 s without a frame, so the pong has to count as traffic |
| routing | the connection's single market, `c.plan.markets[0].rawMarketId` | the snapshot has no `symbol` |
| snapshot | `from === 0`: `resetBook` from the maps and store `to` | |
| delta | apply only when `from === last`, then store `to`, and publish | the rule held on 291 of 291 and 233 of 233 deltas |
| resync | `from !== last`, or a delta before any snapshot: `resync`, which terminates the socket and reopens it | the reopened socket starts with a snapshot |
| levels | `Number(key)` and the numeric size, 0 deletes | prices are keys, sizes are numbers |
| receive time | stamp on arrival | the frames carry no time |
| refused handshake | a 400 means the contract is unknown or disabled, so log it and stop reopening that plan | a 400 answered `NOPEUSDT` and the disabled `EOSUSDT`, and the engine otherwise retries without limit |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |
| family | USDT-M only | the inverse books count USD contracts, section 4 |

If the venue caps anonymous sockets near 5, no public path serves the whole catalog.
The v3 socket answered no book topic, and polling 97 REST books once a second is 970 requests per 10 s against the limit of 500.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BigONE Contract WebSocket API | https://open.big.one/docs/contract/pusher | 2026-09-22 | BigONE, global | URLs, snapshot then real-time, error codes, private stream, sections 1 to 4 and 7 |
| S2 | BigONE Contract WebSocket Guide | https://open.big.one/docs/guides/websocket/contract | 2026-09-22 | BigONE, global | one connection per market and channel, section 1 |
| S3 | BigONE API General Information, and Contract Trading Introduction | https://open.big.one/docs/general-info and https://open.big.one/docs/contract/introduction | 2026-09-22 | BigONE, global | 5 connections per user, strings, milliseconds, `wss://api.big.one/ws/v2`, sections 1, 3 and 5 |
| S4 | BigONE web app bundle `main.0292236fc458b2ea.js` | https://static.peatio.com/main.0292236fc458b2ea.js | 2026-09-22 | BigONE, global | `/ws/v2` with `proto`, `/ws/contract/v3/realtime` and its `{op, args: [{topic, symbol, gid}]}` frame, section 1 |
| P1 | `ws-probe.mjs book`, 04:19 and 04:21 UTC, and the second pass at 04:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs errors`, 04:19 and 04:26 UTC, and the second pass at 04:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | handshake refusals, text frames, sections 3 and 4 |
| P3 | `ws-probe.mjs instruments`, 04:22 UTC, and the second pass at 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 2 |
| P4 | `ws-probe.mjs v3`, 04:23 and 04:24 UTC, and the second pass at 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 6 |
| P5 | `ws-probe.mjs silence`, 04:24 UTC, not rerun in the second pass so that the venue's socket time stayed near ten minutes | [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P6 | `ws-probe.mjs deflate`, 04:19 UTC, and the second pass at 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bigone/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
