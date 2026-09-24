# Gate US REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:15 to 03:29 UTC, and the second pass 03:31 to 03:37 UTC, from the development host near Seattle.

This profile covers the public REST API v4 of Gate US, which is spot only, as the survey plan's template change 1 asks.
Gate US has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every protocol claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written.
The documentation pages at `us.gate.com` refuse this host with HTTP 403, so they were read through a fetch that does not originate here, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | first pass | second pass |
|---|---|---|
| documented base URL | `https://api.gate.us/api/v4`, S4 | |
| `api.gate.us` A records | 52.55.110.232, 100.51.214.36, no CNAME | same |
| server header | `APISIX/3.13.0` | same |
| `GET /spot/currency_pairs`, 192,064 bytes | cold 471 ms, five warm: min 83, median 85, max 166 ms | cold 458 ms, warm: min 81, median 84, max 139 ms |
| `GET /spot/order_book`, warm | 71 to 85 ms, and 269 ms on the first call | 72 to 81 ms, and 251 ms on the first call |
| `GET /spot/tickers`, 76.7 KB, 60 polls | min 73, median 77, p90 94, max 369 ms | min 74, median 78, p90 87, max 377 ms |

P1 to P3.
`api.gateio.ws`, the global Gate host, answered `GET /spot/time` with 200 and `{"server_time":1790133344115}` in 509 ms to a one-off `curl` at 03:15 UTC, so the two venues run separate API hosts with different public paths.

## 2. Catalog

### The instruments call

`GET /spot/currency_pairs` returns every pair in one unpaged reply, 385 rows on both passes, P1.

| field | value on the wire |
|---|---|
| `id` | `BTC_USD`, base and quote joined by `_` |
| `trade_status` | `tradable` on 385 of 385 |
| `quote` | `USDT` on 354, `USD` on 31 |
| `type` | `normal` on 385 |
| `fee` | `"0.2"` on 383, `"0.1"` on `USDT_USD` and `USDC_USDT`, a percent, see [`fees.md`](./fees.md) section 2 |
| `precision`, `amount_precision` | decimals of price and amount, `1` and `6` on `BTC_USD` |
| `min_base_amount`, `min_quote_amount`, `max_base_amount` | `"0.000001"`, `"0.1"` and `"100"` on `BTC_USD` |
| `trade_url` | `https://www.gate.com/en-us/trade/<id>` on 385 of 385 |

The 31 USD pairs are ADA, USDT, NEAR, AVAX, UNI, AXS, ETC, USDC, SAND, CHZ, ALGO, ENA, SOL, FIL, ETH, ICP, BCH, SUI, BTC, FET, XLM, FLOW, MANA, LTC, XRP, VET, AAVE, CRO, ONDO, ATOM and APT against USD.
There is no perpetual catalog, since every futures, delivery and options path answers 404, see [`fees.md`](./fees.md) section 3.

### How CCXT would map it

No CCXT class exists, so the probe pointed the spot-only `gateeu` class at `https://api.gate.us/api/v4`, P1.

| CCXT field | result | evidence |
|---|---|---|
| markets | 385, type `spot`, all `active` | P1 |
| `market.id` | equal to the wire `id` on 385 of 385, and equal to the socket symbol, see [`websocket.md`](./websocket.md) section 3 | P1 |
| `active` | `trade_status === 'tradable'` | `server/node_modules/ccxt/js/src/gate.js` line 1405 |
| `contractSize` | `undefined` for spot | same file, line 1428 |
| `linear` | `undefined` for spot | same file, lines 1423 and 1424 |
| `taker`, `maker` | 0.002 on 383 pairs, 0.001 on 2 | same file, lines 1396, 1397, 1426 and 1427 |

The engine's catalog keeps active swaps only, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 202, so it would load 0 Gate US markets even with a class.

### Pairs listed twice, and price scale

30 bases are listed against both USD and USDT, P1.
USD, USDC and USDT are one settlement family in the engine, so a spot feed would have to pick one pair per base.
Book sizes are base currency units on the wire, see [`websocket.md`](./websocket.md) section 4, so no price or size scale applies.

### Volume

350 of 385 pairs showed a 24 h `quote_volume` of 0 in `GET /spot/tickers` on both passes, P3.
The largest were `ETH_USDT` at 61,457 USDT, `USDE_USDT` at 56,809, `UNI_USDT` at 43,394, `BTC_USDT` at 18,239 and `BCH_USDT` at 17,576, at 03:20 UTC.
Of the 31 USD pairs, 4 had any volume, in the P3 capture.
`BTC_USD` had traded 0.048177 BTC in 24 h, P3, and its last trade, id 3343, was 28,282 s old at 03:22 UTC and 28,848 s old at 03:31 UTC, P4.

## 3. Anchor

Gate US publishes no index, no mark and no funding rate, because it lists no perpetual.
`GET /futures/usdt/contracts` and `GET /futures/usdt/tickers` answer 404 with an openresty HTML page, P1.
The API documentation names no index or reference price endpoint, S4.

The nearest thing to a reference price is the ticker's `last`, and it does not come from Gate US trades.
`GET /spot/tickers` gave `BTC_USD` a `last` of 86,586.7 and 86,701.9 while its own last trade printed at 86,503.2 eight hours earlier, P4.
`SAND_USD` has no trade at all, since `GET /spot/trades` returns `[]`, and its `last` still changed on 3 of 59 one-second polls in both passes, P3 and P4.
A `spot.tickers` frame gave `BTC_USDT` a `last` of 86,695.3 above its own `lowest_ask` of 86,691.6, see [`websocket.md`](./websocket.md) section 6.
`BTC_USD` and `BTC_USDT` both showed `high_24h` 86,835.7, which equals global Gate's `BTC_USDT` `high_24h` read at about 03:22 UTC.
The source of `last`, `change_percentage`, `high_24h` and `low_24h` is therefore an outside price, probably global Gate, and that reading is an inference.

No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

How often the bulk ticker changed over 60 one-second polls:

| field | changes in 59 intervals, first pass | second pass |
|---|---|---|
| `BTC_USD.last` | 5 | 6 |
| `BTC_USD.highest_bid` | 6 | 5 |
| `BTC_USDT.last` | 5 | 6 |
| `ETH_USDT.lowest_ask` | 5 | 6 |
| `SOL_USD.lowest_ask` | 6 | 6 |
| `SAND_USD.last` | 3 | 3 |

No watched field changed on more than 6 of 59 polls, while `spot.book_ticker` sent 66 to 173 `BTC_USD` frames per run of about 61 s, see [`websocket.md`](./websocket.md) section 4.
So the bulk reply is refreshed about every 10 s, and that is an inference from the counts.

## 5. REST book snapshot

`GET /spot/order_book?currency_pair=<id>&limit=<n>&with_id=true`, S4.

| item | documented | probed |
|---|---|---|
| `limit` | "Maximum number of order depth data in asks or bids" | 1 to 100 work. 101 and 1000 answer 200 with `{"asks":[],"bids":[]}` and no `id`, and 0 answers 400 `INVALID_PARAM_VALUE` |
| `with_id` | "Return order book ID" | the `id` is the same counter as the socket's `U`, `u` and `lastUpdateId`, see [`websocket.md`](./websocket.md) section 4 |
| `current`, `update` | ms of generation and of the last book change | integers in ms |
| level order | not stated for REST | bids descending and asks ascending on all 16 reads with levels across both passes |
| whole book | | at `limit=100` `BTC_USD` held 26 to 28 bids and 20 to 23 asks, `BTC_USDT` 40 to 44 and 26 to 31, `ETH_USDT` 50 to 59 and 24 to 30, `SAND_USD` 16 to 21 and 14 to 17 |
| empty books | | `ZEN_USDT`, `PVP_USDT`, `CP_USDT`, `RAVE_USDT` and `AEON_USDT` returned 0 bids and 0 asks on both passes, while `tradable`, P8 |

The level counts include the two recipe reads of P5.
Spread at the touch, from the P2 reads: `BTC_USD` 137 to 279 ppm, `BTC_USDT` 1 to 14 ppm, `ETH_USDT` 11 to 289 ppm, `SAND_USD` 4,277 to 4,303 ppm, P2.

### Caching

The reply is served from a cache, and `current` shows how old it is.

| read | first pass | second pass |
|---|---|---|
| the same URL 20 times, 250 ms apart | 14 distinct `current`, age median 2,621 ms, max 16,952 ms | 13 distinct, median 2,626 ms, max 23,860 ms |
| 20 times with a changing `_` nonce | 13 distinct, median 1,961 ms, max 3,809 ms | 12 distinct, median 2,112 ms, max 5,063 ms |
| single reads in the depth sweep | up to 29,252 ms old | up to 26,896 ms old |
| the nonce read the socket recipe used, `BTC_USD` | 22,540 ms old | 10,070 ms old |

P2 and P5.
A nonce shortens the age but does not remove it.
The documented diff recipe failed on `BTC_USD` in both passes because the REST book was older than the first cached diff, see [`websocket.md`](./websocket.md) section 4.

### Own book, not global Gate's

A read of `BTC_USDT` from `api.gate.us` and `api.gateio.ws` at the same instant gave ids 349,253,662 and 39,948,630,767 and different touches, P2.
In the second pass the Gate US bid of 86,697.5 sat above the global ask of 86,685.3.
So Gate US runs its own matching engine and order books.

## 6. Rate limits and errors

| item | documented, S4 | probed |
|---|---|---|
| public spot | "900r/s" per IP | the header `x-gate-ratelimit-limit` reads `200` |
| counting | | `x-gate-ratelimit-requests-remain` fell by one per request on the same path and stood at 190 after 60 polls at one per second in both passes, which fits 200 per 10 s per path |
| reset | | `x-gate-ratelimit-reset-timestamp` equalled the second of the `Date` header |
| over the limit | "the request will have a delay" below a burst rate and "will be declined" above it | not provoked, so the status code and `Retry-After` are Not verified |

The documented 900 per second and the 200 in the header disagree, so a poller should stay inside 200 per 10 s.

| request | status | body |
|---|---|---|
| `order_book?currency_pair=NOPE_USD` | 400 | `{"label":"INVALID_CURRENCY","message":"Invalid currency NOPE"}` |
| `order_book` with no pair | 400 | `{"label":"MISSING_REQUIRED_PARAM","message":"Missing required parameter: currency_pair"}` |
| `order_book?limit=0` | 400 | `` {"label":"INVALID_PARAM_VALUE","message":"Invalid request parameter `limit` value: 0"} `` |
| `order_book?limit=101` | 200 | `{"asks":[],"bids":[]}` |
| `tickers?currency_pair=NOPE_USD` | 400 | `INVALID_CURRENCY` as above |
| `/spot/nope` | 400 | `{"message":"Missing required header: Timestamp","label":"MISSING_REQUIRED_HEADER"}`, with `x-gate-ratelimit-limit: 0` |
| `/futures/usdt/contracts` | 404 | openresty HTML page |
| `/margin/uni/currency_pairs` | 500 | `{"label":"SERVER_ERROR","message":"Internal server error"}` |

P1 and P4.
An unknown path under `/spot` is answered as a private call, not as a 404.

## 7. Server time and clock offset

`GET /spot/time` is not public on Gate US.
It answers 400 "Missing required header: Timestamp", and with a `Timestamp` header 400 "Missing required header: KEY", P4.
Global Gate serves the same path publicly, section 1.

The book's `current` minus the local midpoint of the request was 3 to 4 ms on the fresh reads of both passes, and the other reads were cached copies up to 22 s older, P4.
The `Date` header agreed with the local clock to the second.
So the host clock is within about 5 ms of Gate US.

## 8. Recommended poller shape

None.
Gate US publishes no index, mark or funding, section 3, so there is nothing for an anchor poller to read.
If a spot leg were ever added, the socket feeds the book, see [`websocket.md`](./websocket.md) section 8, and the REST book is not a substitute because it is cached for seconds, section 5.

## 9. Source ledger

Ledger ids are shared by the three Gate US files, so an id missing here is used in another file.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S4 | Gate US API v4 documentation, v4.90.1 | https://us.gate.com/docs/developers/apiv4/ | 2026-09-22 | Gate US, Inc., US | base URL, rate limit table, order book parameters, spot only, sections 1, 3, 5 and 6 |
| S8 | CCXT 4.5.68 `gate.js` and `gateeu.js` | `server/node_modules/ccxt/js/src/gate.js`, `server/node_modules/ccxt/js/src/gateeu.js` | 2026-09-22 | CCXT | spot market mapping, section 2 |
| P1 | `rest-probe.mjs catalog`, at 03:20 and 03:31 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) | 2026-09-22 | this host | DNS, catalog, product paths, CCXT mapping, sections 1 to 3 and 6 |
| P2 | `rest-probe.mjs book`, at 03:20 and 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) | 2026-09-22 | this host | depth, level order, cache, the global comparison, section 5 |
| P3 | `rest-probe.mjs ticker`, at 03:20 and 03:32 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) | 2026-09-22 | this host | ticker latency, volume, change counts, rate limit counter, sections 1, 2, 4 and 6 |
| P4 | `rest-probe.mjs errors`, at 03:22 and 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) | 2026-09-22 | this host | error shapes, server time, clock, last trades, sections 2, 3, 6 and 7 |
| P5 | `ws-probe.mjs book`, at 03:23 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | the REST read inside the diff recipe, section 5 |
| P8 | `ws-probe.mjs errors`, at 03:28 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | the REST reads of the empty books, section 5 |
