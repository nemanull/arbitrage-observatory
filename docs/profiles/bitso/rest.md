# Bitso REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 01:18 to 01:31 UTC, and the second pass 01:39 to 01:43 UTC, from the development host near Seattle.

This profile covers the public REST API v3 of Bitso (CCXT id `bitso`) for its spot books, because Bitso lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) unless a source row is named.
Bitso allows 60 public requests per minute per IP and locks an IP out past that, so the probe spaces its requests 2 s apart and never tests the limit.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| documented base | `https://stage.bitso.com/api/v3` and `https://sandbox.bitso.com/api/v3` in the examples, and no production host is spelled out | S2, S4 |
| production hosts used | `https://api.bitso.com/v3` and `https://bitso.com/api/v3`, which returned the same 47,470 byte `available_books` reply. CCXT uses `https://bitso.com/api` plus `/v3` | `curl` at 01:18 UTC, and `server/node_modules/ccxt/js/src/bitso.js` lines 137 to 139 and 1926 |
| resolved addresses | `api.bitso.com`, `bitso.com` and `ws.bitso.com` all resolve to `162.159.130.10` and `162.159.133.10`, Cloudflare | `rest-probe.mjs catalog`, tag `dns` |
| edge | `server: cloudflare`, `cf-ray` suffix `YVR` or `SEA`, `cf-cache-status: DYNAMIC`, and an `x-envoy-upstream-service-time` of 8 to 12 ms | tags `available_books` and `error_shape` |
| cold request | 165 and 173 ms for `available_books` in two runs, TLS included | tag `available_books` |
| warm request | `available_books` 100 to 111 ms, median 105, and 103 to 109 ms, median 104, over 5 each. `ticker` for every book 90 to 407 ms, median 98, p90 186, and 87 to 164 ms, median 93, p90 113, over 30 each | tags `available_books_warm` and `ticker_bulk` |
| refusals | none. Every public call answered without a challenge | all modes |

## 2. Catalog

### The instruments call

`GET /v3/available_books/` returns every book in one reply, 54 on 2026-09-23 at 01:20 and 01:39 UTC, 47,470 bytes both times.
Each row has, as S1 documents, `book`, `default_chart`, `fees`, `margin_enabled`, `minimum_amount`, `maximum_amount`, `minimum_price`, `maximum_price`, `minimum_value`, `maximum_value` and `tick_size`, and every row had all eleven.
There is no status field.
A book that stops trading leaves the list, as the nine books hibernated on 2026-09-10 did, see [`fees.md`](./fees.md) section 3.

| quote | books |
|---|---:|
| `usd` (Bitso's Digital dollars, USDC and USDT held as one balance) | 26 |
| `mxn` | 12 |
| `usdt` | 5 |
| `brl` | 4 |
| `ars` | 3 |
| `cop` | 2 |
| `usds` | 1 |
| `btc` | 1 |

No book is a perpetual, a future or an option.

### How CCXT 4.5.68 maps it

Every CCXT line below is in S6.

| field | CCXT value | against the socket and the engine | evidence |
|---|---|---|---|
| `id` | `book`, for example `btc_usd` | identical to the socket's `book` and the REST `book` on 54 of 54 | tag `ccxt_fields`, `idEqualsInfoBook` true |
| `symbol` | `BASE/QUOTE` upper case, `BTC/USD` | | tag `ccxt_btc_usd` |
| `type` | `spot` on 54 of 54 | the connector keeps only `type === 'swap'`, so 0 markets survive, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203 | tag `ccxt_fields`, and `server/node_modules/ccxt/js/src/bitso.js` line 544 |
| `active` | `undefined` on 54 of 54 | the connector's `active !== false` would pass it | `server/node_modules/ccxt/js/src/bitso.js` line 550 |
| `contractSize` | `undefined` on 54 of 54 | the connector turns it into 1, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 188 to 194, which is right for sizes in the base currency | `server/node_modules/ccxt/js/src/bitso.js` line 556, and [`websocket.md`](./websocket.md) section 4 |
| `linear` | `undefined` on 54 of 54 | | line 552 |
| `taker` and `maker` | `fees.structure[0]`, `0.0036` and `0.003` on `BTC/USD` | see [`fees.md`](./fees.md) section 8 | tag `ccxt_btc_usd` |
| `precision.price` | `tick_size`, 1 on `btc_usd` | | tag `ccxt_btc_usd` |
| load time | 2,307 and 2,720 ms for `loadMarkets`, two requests (`available_books` and `catalogues`) under CCXT's 2,000 ms `rateLimit` | | tag `ccxt_loadMarkets` |

### Pairs listed twice, and price scale

Within the engine's USD, USDC and USDT family, four bases have more than one book: `BTC` on `usd` and `usdt`, `ETH` on `usd` and `usdt`, `SOL` on `usd` and `usdt`, and `XRP` on `usd` and `usdt`, in tag `ccxt_pairs_in_usd_family_twice`.
A spot leg would need a `marketFilter` to pick one of each.
`btc_usds` quotes Sky's USDS, which is outside the family.
No book is quoted per 10 or per 1000 units, so no price scale applies.

## 3. Anchor

Bitso publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The only reference prices on the public API are in the ticker: `last`, the 24 h `vwap`, `high`, `low` and `change_24` (S4).
None of them is an index built from other venues.

`GET /v3/ticker/` without a `book` returns all 54 books in one reply, although S4 marks `book` as required and CCXT declares `fetchTickers` false, at `server/node_modules/ccxt/js/src/bitso.js` line 114.
The reply was 14,415 to 14,427 bytes over 60 polls in two runs, with a median of 98 and 93 ms.
Each row has `high`, `last`, `created_at`, `book`, `volume`, `vwap`, `low`, `ask`, `bid`, `change_24` and `rolling_average_change`.

No anchor poller is recommended.
An `AnchorRow` for Bitso would have a mark of 0, and the reader refuses such a route at open with `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 36 to 38.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.

How often the ticker fields changed over 30 polls 2 s apart, 29 intervals, at 01:21 UTC and again at 01:40 UTC, first run then second:

| book | `bid` | `ask` | `last` | `vwap` | `volume` |
|---|---|---|---|---|---|
| `btc_usd` | 16, 9 | 14, 10 | 1, 2 | 10, 9 | 10, 9 |
| `btc_usdt` | 12, 11 | 10, 9 | 1, 0 | 2, 0 | 2, 0 |
| `eth_usd` | 11, 8 | 13, 11 | 0, 2 | 1, 7 | 1, 7 |
| `btc_mxn` | 5, 0 | 0, 0 | 1, 2 | 12, 14 | 12, 14 |
| `usd_mxn` | 0, 1 | 0, 1 | 10, 6 | 13, 19 | 13, 19 |
| `bar_usd` | 0, 0 | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| `tusd_btc` | 0, 0 | 0, 0 | 0, 0 | 0, 0 | 0, 0 |

44 of 54 books changed at least one field in each run.
`created_at` took 30 distinct values over the 30 replies of the first run and 31 over the second, and in a `curl` reply at 01:18:16 UTC every one of the 54 rows, the dead `tusd_btc` included, read `2026-09-23T01:18:16+00:00`.
So it is the time the reply was built, not the time of the last change.

## 5. REST book snapshot

| call | reply | evidence |
|---|---|---|
| `GET /v3/order_book/?book=btc_usd` | aggregated by price, 50 bids and 50 asks, 5,746 and 5,745 bytes, 173 and 180 ms in two runs. Levels are `{book, price, amount}` | tag `order_book_aggregated` |
| `GET /v3/order_book/?book=bar_usd` | 14 bids and 50 asks in both runs | same |
| `GET /v3/order_book/?book=tusd_btc` | 37 bids and 50 asks, on a book with 0 volume in 24 h, and the same `sequence` 214869998 at 01:21 and 01:40 UTC | same |
| `GET /v3/order_book/?book=btc_usd&aggregate=false` | the whole book, 2,836 bid and 3,555 ask orders at 1,531 and 1,754 prices, 520,199 bytes, 253 ms, and 2,847 and 3,560 orders, 521,502 bytes, 165 ms in the rerun. Orders are `{book, price, amount, oid}` | tag `order_book_whole` |
| `GET /v3/order_book/?book=btc_mxn&aggregate=false` | 3,470 bid and 4,172 ask orders at 1,924 and 2,342 prices, 632,898 bytes, 187 ms, and 3,472 and 4,173 orders, 633,156 bytes, 313 ms in the rerun | same |

S2 documents `aggregate` true by default, returning "only the top 50 orders for each side", which the wire shows as 50 price levels.
Bids are descending and asks ascending in both forms, on every book probed.
`sequence` is a string, `"3633400037"`, and it is the same per book counter the `diff-orders` socket carries as a number, see [`websocket.md`](./websocket.md) section 4.
`updated_at` equalled the reply's own second on all four books, including the dead `tusd_btc`, so it is not the time of the last change.
Three calls 2 s apart on `btc_usd` returned sequences 3633400370, 3633400397 and 3633400407 with `cf-cache-status: DYNAMIC`, and 3633431124, 3633431193 and 3633431273 in the rerun, so the book is not cached.
The `ticker` best bid and ask equalled the aggregated book's top level read 2 s later, `86669` and `86694`, and `86398` and `86412` in the rerun.

The REST book is the only way to seed the socket's book, and one call per book fits the rate limit only slowly, see section 6.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | "The limit for public API requests (no need for authentication) is by IP address, which allows 60 requests per minute (RPM)", in one minute windows, S3 | not tested. The probe stayed at 30 requests a minute or fewer |
| penalty | "If you exceed these limits, then the system locks you out for one minute. Continuous one-minute lockouts might result in a 24-hour block.", S3 | not tested |
| limit error | category 08, HTTP 420: "0801: You have hit the request rate-limit", "0802: Too many attempts to perform an operation", S5 | not seen |
| `Retry-After` or limit headers | Not publicly specified | none. The full header set of a `curl` reply to `GET /v3/ticker/` at 01:18 UTC had `date`, `content-type`, `content-length`, `x-envoy-upstream-service-time`, `server`, `x-content-type-options`, `cf-cache-status`, `strict-transport-security` and `cf-ray`, plus a `set-cookie`, and the probe saw no `retry-after` on any reply |
| CCXT | `rateLimit` 2,000 ms, "30 requests per minute" | `server/node_modules/ccxt/js/src/bitso.js` line 24 |

The engine's poller pauses on 403, 418 and 429 only, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1.
Bitso's documented limit status is 420, so a Bitso poller would have to add it.

Error shapes, probed at 01:23 UTC and again at 01:42 UTC with the same statuses and bodies:

| request | status | body |
|---|---|---|
| `GET /v3/ticker/?book=nope_usd` | 400 | `{"error":{"code":20,"message":"Unknown OrderBook nope_usd"}}`, a number code and no `success` field |
| `GET /v3/order_book/?book=nope_usd` | 400 | `{"error":{"code":"0301","details":[],"message":"Unknown order book nope_usd"},"success":false}` |
| `GET /v3/order_book/` | 400 | `{"error":{"code":"0301","details":[],"message":"Unknown order book missing"},"success":false}` |
| `GET /v3/trades/?book=nope_usd` | 200 | `{"payload":[],"success":true}` |
| `GET /v3/nope/` | 404 | empty |

S3 documents the envelope `{ "success": false, "error": {"message": ERROR_MESSAGE, "code": ERROR_CODE} }`.
The ticker's refusal does not follow it, and the trades call answers an unknown book with success.

## 7. Server time and clock offset

Bitso publishes no time call, and CCXT declares `fetchTime` false, at `server/node_modules/ccxt/js/src/bitso.js` line 115.
The `Date` header and the ticker's `created_at` have one second resolution, and at 01:23:37.366 and 01:42:31.665 local UTC both read the same second.
The socket's acknowledgement carries `time` in ms, and it put the server within a few tens of ms of this host, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

None.
Bitso has no index, mark or funding to poll, and the engine refuses a route whose venue has no mark.

If spot legs are ever added, the REST calls a feed would need are these.

| item | recommendation | reason |
|---|---|---|
| catalog | `GET /v3/available_books/` through CCXT `loadMarkets` | one call, `id` equals the socket's `book` |
| book seed | `GET /v3/order_book/?book=<id>&aggregate=false` once per book after the socket subscribes, queued at no more than one call a second | the socket sends no snapshot, and 60 calls a minute is the IP's whole public budget |
| reference price | `GET /v3/ticker/` for all books at most every 2 s, if a later design wants `last` or `vwap` as a sanity check | one call, 14.4 KB, and it is not an index |
| rate limit pause | 60,000 ms on HTTP 420 | the documented lockout is one minute |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading API, List Available Books, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/list-available-books | 2026-09-22 | Bitso | row fields, section 2 |
| S2 | Trading API, List Order Book, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/list-order-book | 2026-09-22 | Bitso | `aggregate`, top 50, `sequence`, `updated_at`, section 5 |
| S3 | Trading API, General, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/general-concepts | 2026-09-22 | Bitso | response envelope, 60 RPM public limit, lockout, section 6 |
| S4 | Trading API, Get Ticker, updated 2026-03-13 | https://docs.bitso.com/bitso-api/docs/ticker | 2026-09-22 | Bitso | ticker fields, `book` marked required, sections 3 and 4 |
| S5 | Trading API, 08: Throttling Errors | https://docs.bitso.com/bitso-api/docs/throttling-errors-08-http-420 | 2026-09-22 | Bitso | HTTP 420 and codes 0801 and 0802, section 6 |
| S6 | CCXT 4.5.68 `bitso.js` | `server/node_modules/ccxt/js/src/bitso.js` | 2026-09-22 | CCXT | REST base, market mapping, `fetchTickers` and `fetchTime` false, `rateLimit`, sections 1, 2, 6 and 7 |
| P1 | `rest-probe.mjs catalog` at 01:20 UTC, and the `curl` calls of 01:18 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 2 |
| P2 | `rest-probe.mjs book` at 01:20 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P3 | `rest-probe.mjs ticker` at 01:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3 and 4 |
| P4 | `rest-probe.mjs errors` at 01:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 6 and 7 |
| P5 | second pass reruns, `catalog` at 01:39, `book` at 01:40, `ticker` at 01:40, `errors` at 01:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitso/rest-probe.mjs) | 2026-09-23 UTC | this host | the second readings |
