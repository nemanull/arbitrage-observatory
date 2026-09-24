# Coins.ph REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, from the development host near Seattle, between 03:15 and 03:40 UTC on 2026-09-23.

This profile covers the public REST API of Coins.ph (CCXT id `coinsph`) that a catalog, a book resync or an anchor poller would use.
Coins.ph lists no perpetual, so the catalog below is the spot market, as change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, see [`fees.md`](./fees.md) section 3.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs), run from `server/`, with its runs listed in section 9.
Where the documentation and the wire disagree, both are written.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base URL | `https://api.pro.coins.ph` | S1, and CCXT `coinsph.js` lines 177 to 180 |
| resolved address | 104.18.22.77 and 104.18.23.77, Cloudflare, no CNAME | P1 |
| edge | `cf-ray` ended in `SEA` on every first pass call, and in `YVR` on the later calls of the second pass. `cf-cache-status: DYNAMIC` on every market data reply | P1 to P3 |
| cold request | `GET /openapi/v1/ping` in 193 and 531 ms, answering `{}` | P1 |
| warm request | 116 to 135 ms over five pings in each of two runs, medians 118 and 129 ms | P1 |
| access | open, no refusal on any public path, and HTTP 200 on every market data call | P1 to P4 |

`wsapi.pro.coins.ph` and `www.coins.ph` resolve to the same two addresses, P1.

## 2. Catalog

### The instruments call

`GET /openapi/v1/exchangeInfo` returns every symbol in one reply of 186,341 bytes in 213 and 241 ms, P1.
It accepts `symbol` or a comma list in `symbols`, S1, and `?symbol=ETHPHP` returned one row in 1,126 bytes, P3.

| status on the wire | count | quote assets |
|---|---:|---|
| `trading` | 71 | PHP 42, USDT 22, USDC 7 |
| `break` | 113 | PHP 99, USDT 12, XRP 1 (`BONKXRP`), and a test pair `123456` with base `123` and quote `456` |
| total | 184 | |

The documentation lists the status values in capitals, `TRADING`, `BREAK` and `CANCEL_ONLY`, S1, while the wire sends them in lower case.
No `cancel_only` symbol existed on 2026-09-23 UTC.
`GET /openapi/v1/pairs` returned 71 rows, one per `trading` symbol, as `{"symbol":"SHIBPHP","quoteToken":"PHP","baseToken":"SHIB"}`, P1.
A `break` symbol is not served by the book call, which answers `{"code":-100011,"msg":"Not supported symbols"}` for `ETHFIPHP`, P3.

Every row carries `symbol`, `status`, `baseAsset`, `baseAssetPrecision`, `quoteAsset`, `quoteAssetPrecision`, `orderTypes` and `filters`, P1.
The filters are `PRICE_FILTER`, `LOT_SIZE`, `NOTIONAL`, `MIN_NOTIONAL` and the order count limits on all 184, plus `STATIC_PRICE_RANGE`, `PERCENT_PRICE_BY_SIDE` and `PERCENT_PRICE_ORDER_SIZE` on 169, P1.

### How CCXT 4.5.68 maps it

| CCXT field | value | source |
|---|---|---|
| markets after `loadMarkets` | 184, all `type: 'spot'`, 71 `active: true` and 113 `active: false` | P1 |
| swap markets | 0 | P1 |
| `market.id` | the exchange `symbol` on 184 of 184, upper case, as `BTCPHP` | P1 |
| `active` | `status` lowered and compared with `trading` | `coinsph.js` line 837 |
| `linear`, `contractSize`, `taker`, `maker` | `undefined`, set explicitly | `coinsph.js` lines 839 to 843 |
| requests made | one, `exchangeInfo`, in 216 and 684 ms. `fetchCurrencies` returns `{}` without credentials | P1, `coinsph.js` lines 562 to 565 |
| pairs listed twice | none in the catalog | P1 |

The socket names a stream in lower case, `btcphp@depth20@100ms`, and spells the symbol in upper case inside each frame, `"s":"BTCPHP"`, so `market.id` matches the frame field and needs lowering for the subscribe, see [`websocket.md`](./websocket.md) section 3.
The REST book call accepts either case, since `symbol=btcphp` returned a book, P2.
Sizes on the REST and socket books are base asset quantities, and the connector turns the `undefined` contract size into 1 at `server/src/ccxt/connector.ts` lines 188 to 194, which is right for spot.

The bulk ticker replies are not a clean catalog.
`GET /openapi/quote/v1/ticker/bookTicker` returned 232 rows for 201 distinct symbols, 18 of them absent from `exchangeInfo`, and 24 symbols appeared two or three times, all USDT or USDC pairs such as `BTCUSDT`, `ETHUSDT` and `SOLUSDT`, P2.
In the read at 03:27 UTC the copies of `SHIBUSDT` carried different asks, `0.00000617` in one row and `0.00000619` in the other two, P2.
`ticker/24hr` and `ticker/price` returned 217 rows for 186 distinct symbols, P2.
All 71 `trading` symbols were present in each bulk reply, with a two-sided book in `bookTicker`, P2.
A `break` symbol can still show a quote there, and in the same read 61 of the 113 had a two-sided `bookTicker` row, among them `WLDPHP` at 22.78 and 22.84 PHP, P2.

## 3. Anchor

Coins.ph publishes no index price, mark price, funding rate, funding interval or next settlement for any symbol.
No call in S1 returns them, and none of the fields of `ticker/bookTicker`, `ticker/24hr` or `ticker/price` is named for an index, mark or funding, P2.

Two reference prices exist.

| name | where | what it is | probed |
|---|---|---|---|
| index price | `PERCENT_PRICE_INDEX` filter, S1 | "the index price, which is calculated from several exchanges in the market according to certain rules", used to bound order prices, with "indexPrice websocket pushing will be available in the future" | the filter is on 0 of 184 symbols, and no call returns the index, P1 |
| average price | `GET /openapi/quote/v1/avgPrice?symbol=` | a 5 minute average of trade prices for one symbol | `{"mins":5,"price":"5413885.700575314650379515"}` for `BTCPHP` in 116 ms, P2 |

Neither fills an `AnchorRow`, and no anchor poller is recommended, see section 8.

## 4. Anchor semantics

Not applicable, since there is no perpetual, no mark and no funding.
The index behind the `PERCENT_PRICE_INDEX` filter has no published basket or formula beyond the sentence quoted in section 3.
The `avgPrice` reply is one symbol per call, so a bulk read of it would cost 71 requests of the 120 per minute budget in section 6.

## 5. REST book snapshot

`GET /openapi/quote/v1/depth?symbol=<id>&limit=<n>` returns `{"lastUpdateId": <integer>, "bids": [[price, qty], …], "asks": [[price, qty], …]}`, S1.

| `limit` | levels per side on `BTCPHP` | documented weight | time |
|---|---|---|---|
| absent | 100 | 1 | 204 and 432 ms, the first call of each run |
| 5, 20, 50, 100 | as asked | 1 | 116 to 132 ms |
| 200 | 200 | 5 | 119 and 120 ms |
| 201, 500 | 200 | | 114 to 120 ms |
| 0 | 100, while S1 warns "setting limit=0 can return 200 records" | | 119 and 120 ms |

The data is from P2.
Bids come best first in descending price and asks best first in ascending price at every limit, P2.
Prices and sizes are strings with 18 decimals, `"5410792.100000000000000000"`, where the socket sends the short form `"5410792.1"`, P2 and [`websocket.md`](./websocket.md) section 6.
`lastUpdateId` is a JSON integer, and it shares one sequence with the socket's diff `u` and partial depth `lastUpdateId`.
The REST book at a given `lastUpdateId` equalled the book rebuilt from the socket at the same id on every check, see [`websocket.md`](./websocket.md) section 4.

Eight reads of `BTCUSDT` one second apart returned 5 distinct ids in one run and 3 in the other, with medians of 119 and 120 ms, and `cf-cache-status: DYNAMIC` on each, P2.
The repeated ids fell on reads where the top of the book had not moved, and nothing points to an edge cache.
The documented order book recipe fetches this call once per symbol after subscribing the diff stream, S2.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| IP limit | 120 requests per minute across `/openapi/*`, since 2026-03-16, down from 1,200. A separate UID limit of 180 per minute | not reached, the probes spaced calls one second apart, P1 to P4 |
| weight | per endpoint: 1 for most market data, 5 for `depth` at 200 levels, 2 for `ticker/price` and `ticker/bookTicker` without a symbol, 40 for `ticker/24hr` without a symbol | the `x-sapi-used-ip-weight-1m` header counted one per request on each path separately and restarted each minute: nine `depth` calls read 1 to 9 whatever the limit, while `ticker/bookTicker`, `ticker/24hr` and `ticker/price` each read 1, and ten `time` calls read 1 to 10 |
| 429 | rate limit broken, with `Retry-After` in seconds | not provoked |
| 418 | automatic IP ban after ignoring 429, lasting 2 minutes to 3 days, with `Retry-After` | not provoked |
| 403 | web application firewall limit | not seen |
| error body | `{"code": -1000, "msg": "…"}`, S1 and S3 | as documented, but with HTTP 200 for a symbol error |

CCXT still sets `'rateLimit': 50` with the comment "1200 per minute" at `coinsph.js` line 23, which is ten times the current IP limit.

| request | HTTP | body |
|---|---|---|
| `depth?symbol=NOPEPHP` | 200 | `{"code":-100011,"msg":"Not supported symbols"}` |
| `depth?symbol=ETHFIPHP`, a `break` symbol | 200 | `{"code":-100011,"msg":"Not supported symbols"}` |
| `ticker/bookTicker?symbol=NOPEPHP` | 200 | `{"code":-100011,"msg":"Not supported symbols"}` |
| `depth` without `symbol` | 400 | `{"code":-1010,"msg":"Missing required parameter 'symbol'"}` |
| `depth?symbol=BTCPHP&limit=abc` | 400 | `{"code":-1010,"msg":"Failed to convert value of type 'java.lang.String' to required type 'int'; …"}` |
| `/openapi/quote/v1/nope` | 404 | `{"timestamp":"2026-09-23T03:17:00.871+00:00","status":404,"error":"Not Found","path":"/openapi/quote/v1/nope"}` |
| `/openapi/v1/account` without a key | 200 | `{"code":-1002,"msg":"You are not authorized to execute this request"}` |

The data is from P3.
A client therefore has to read `code` in a 200 body, since an unknown or closed symbol does not produce an HTTP error.
The `-1003 TOO_MANY_REQUESTS` code reads "Too many requests, current limit is %s requests per %s.", S3.

## 7. Server time and clock offset

`GET /openapi/v1/time` returns `{"serverTime": <ms>}`, S1.
Nineteen warm reads over two runs took 111 to 139 ms, after one cold read of 505 ms.
At the midpoint of each warm read the server clock stood 4 to 6 ms ahead of this host on 18 reads and 7 ms behind on the one read of 139 ms, with a median of 5 ms in both runs, P4.
The cold read's offset of 190 ms is its connection setup, not the clock.
`exchangeInfo` also carries `serverTime` and `timezone: "UTC"`, P1.

## 8. Recommended poller shape

No anchor poller.
Coins.ph publishes no index, mark or funding, so there is no `AnchorRow` to fill, and a spot venue has no premium for the anchor reader to judge.

If a later design ever adds spot legs, two REST uses remain.

| use | call | reason |
|---|---|---|
| catalog refresh | `GET /openapi/v1/exchangeInfo`, keep `status === 'trading'` | 71 of 184 symbols trade, and `break` symbols are refused by the book call |
| book resync, only for the diff stream | `GET /openapi/quote/v1/depth?symbol=<id>&limit=200` | the recipe of S2, see [`websocket.md`](./websocket.md) section 8 for why the partial depth stream avoids it |
| do not use | the bulk `ticker/*` replies as a catalog | duplicated and stale rows, section 2 |
| rate limit pause | 60 s on 429, or `Retry-After` when present | the limit window is one minute |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coins.ph API documentation, Rest-Api, change log to 2026-09-09 | https://docs.coins.ph/rest-api/ | 2026-09-22 | Coins.ph | base URL, status values, limits and weights, `depth`, `avgPrice`, `PERCENT_PRICE_INDEX`, sections 1 to 7 |
| S2 | Coins.ph API documentation, Web-Socket-Streams, section "How to manage a local order book correctly" | https://docs.coins.ph/web-socket-streams/ | 2026-09-22 | Coins.ph | resync recipe, sections 5 and 8 |
| S3 | Coins.ph API documentation, Errors | https://docs.coins.ph/errors/ | 2026-09-22 | Coins.ph | error codes, section 6 |
| C1 | CCXT 4.5.68 `coinsph.js` | `server/node_modules/ccxt/js/src/coinsph.js` | 2026-09-22 | CCXT | URLs, market mapping, `rateLimit`, sections 1, 2 and 6 |
| P1 | `rest-probe.mjs catalog`, 03:15 UTC on 2026-09-23, and `rest-probe.mjs all` in the second pass at 03:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs) | 2026-09-22 | this host | DNS, latency, catalog, CCXT, sections 1 to 3 |
| P2 | `rest-probe.mjs book`, 03:16 and 03:27 UTC on 2026-09-23, and the second pass at 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs) | 2026-09-22 | this host | book limits and order, bulk tickers, `avgPrice`, sections 2, 3 and 5 |
| P3 | `rest-probe.mjs errors`, 03:16 UTC on 2026-09-23, and the second pass at 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs) | 2026-09-22 | this host | error bodies and the weight header, sections 2 and 6 |
| P4 | `rest-probe.mjs time`, 03:17 UTC on 2026-09-23, and the second pass at 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs) | 2026-09-22 | this host | clock offset, section 7 |
