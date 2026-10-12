# Cryptomus REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time, 03:15 to 03:30 UTC on 2026-10-10, from the development host near Seattle through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the spot market of Cryptomus (CCXT id `cryptomus`), because the venue lists no perpetual, see [fees.md](./fees.md) section 3.
The plan's template change 1 applies, so section 3 records that no index, mark or funding exists and recommends no anchor poller.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/cryptomus/rest-probe.py), P1, and [`ccxt-probe.py`](../../../scripts/probes/venues/cryptomus/ccxt-probe.py), P2.
CCXT claims cite `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/cryptomus.js`, shortened below to `cryptomus.js`.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| exit | Cloudflare trace `loc=CA` | P1 |
| `api.cryptomus.com` | 91.216.220.72, behind nginx | P1 |
| `api-app.cryptomus.com`, `cryptomus.com`, `doc.cryptomus.com` | the same address, 91.216.220.72 | P1 |
| `api-ws.cryptomus.com`, `exchange-ws.cryptomus.com` | NXDOMAIN, see [websocket.md](./websocket.md) section 1 | P1 |
| cold request, a new TLS connection each time, `GET /v1/exchange/market/tickers` | about 520 ms | P1 |
| warm request on one kept-alive connection | about 240 to 260 ms | P1 |

The server sends `Keep-Alive: timeout=30`, P1.

## 2. Catalog

### The instruments call

| item | value | source |
|---|---|---|
| call | `GET https://api.cryptomus.com/v2/user-api/exchange/markets`, public despite the `user-api` path | S1, P1 |
| same list on the web app host | `GET https://api-app.cryptomus.com/v1/exchange/market`, the same 103 symbols | S2, P1 |
| reply | `{"result":[...]}`, about 39 KB | P1 |
| fields per pair | `id` (a ULID), `symbol`, `baseCurrency`, `quoteCurrency`, `baseMinSize`, `quoteMinSize`, `baseMaxSize`, `quoteMaxSize`, `basePrec`, `quotePrec`, `pricePrec`, `baseCurrencyFullName`, `quoteCurrencyFullName` | P1 |
| status field | none, every listed pair is presumed tradable | P1 |
| pairs | 103, 86 quoted in USDT and 17 in USDC | P1 |
| symbol form | `BASE_QUOTE`, for example `BTC_USDT`, no duplicates | P1 |
| bases listed against both USDT and USDC | 17 | P1 |
| `BTC_USDT` row | `basePrec` `"8"`, `quotePrec` `"6"`, `pricePrec` `"1"`, `baseMinSize` `"0.00001"`, `quoteMinSize` about `"0.85"` | P1 |

`pricePrec` is the price tick in decimals, and the REST book's BTC_USDT levels step by 0.1 at scale 0, section 5.
The documentation describes `basePrec` and `quotePrec` as decimal places of the base and quote amounts and does not list `pricePrec`, S1.

The tickers call `GET /v1/exchange/market/tickers` returns 105 rows under `data`, with `currency_pair`, `last_price`, `base_volume` and `quote_volume` only, P1.
Two of them, `RIO_USDT` and `SAND_USDT`, are not in the catalog, P1.
The documentation shows the reply under `result` with `state`, while the wire uses `data`, S1 and P1.
The ticker reports a 24 hour BTC_USDT quote volume of about USD 132 million, P1.

### How CCXT 4.5.68 maps it

| field | CCXT | source |
|---|---|---|
| call | `fetchMarkets` calls `publicGetV2UserApiExchangeMarkets` | `cryptomus.js` line 279 |
| `market.id` | the venue `symbol`, `BTC_USDT`, which is what the REST book path and the documented socket use | `cryptomus.js` line 325, P2 |
| `type` | `spot` for all 103 pairs | `cryptomus.js` line 332, P2 |
| `active` | hard-coded `true` | `cryptomus.js` line 331 |
| `contractSize`, `linear` | `undefined` | `cryptomus.js` lines 342 and 343, P2 |
| `precision.amount` | from `quotePrec`, `1e-06` for BTC/USDT | `cryptomus.js` line 355, P2 |
| `precision.price` | from `basePrec`, `1e-08` for BTC/USDT | `cryptomus.js` line 356, P2 |
| `limits.amount.min` | from `quoteMinSize` | `cryptomus.js` line 360 |
| `limits.price.min` | from `baseMinSize` | `cryptomus.js` line 364 |

CCXT crosses the precision and limit fields.
For BTC/USDT it reports a price tick of `1e-08` where the venue's `pricePrec` and the book say 0.1, and an amount step of `1e-06` where `basePrec` says 8 decimals, P1 and P2.
It ignores `pricePrec`, which its sample reply at `cryptomus.js` lines 303 to 315 does not show, so the field was likely added after the class was written.
A spot leg would need its own tick and step from `pricePrec` and `basePrec`.

## 3. Anchor

`Not offered`.
The venue lists no perpetual, so it publishes no index, mark, funding rate, funding interval or next settlement.
No call in the documentation's market-cap or exchange sections returns any of them, S1.
`GET /v1/exchange/market/funding-rate` and `GET /v1/exchange/market/mark-price` return nginx 404, P1.
CCXT sets `fetchFundingRate` to `false` at `cryptomus.js` line 90.

The venue's only reference price is the last trade price.
It is published by `GET https://api.cryptomus.com/v2/user-api/exchange/markets/price?symbol=BTC_USDT`, which returned `{"price":"82583.2"}`, and by `last_price` in the tickers call, S1 and P1.
CCXT declares the price call at `cryptomus.js` line 175 as `v2/user-api/exchange/market/price`, singular, which returns nginx 404, P1.
The documented path is `markets/price`, plural, S1.

No anchor poller is recommended.

## 4. Anchor semantics

`Not offered`, for the reason in section 3.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET https://api.cryptomus.com/v1/exchange/market/order-book/{currencyPair}?level={0..5}` | S1 |
| `level` | required, a missing `level` answers 422 `"This value should not be blank."` | S1, P1 |
| what `level` means | a price aggregation scale, not a depth: for BTC_USDT, level 0 steps by 0.1, level 1 by 1, level 2 by 10 and level 3 by 100 | P1 |
| levels 4, 5 and 6 | 200 with empty `bids` and `asks` for BTC_USDT | P1 |
| depth | 50 levels per side at levels 0 to 3, with no depth parameter | P1 |
| reply | `{"data":{"timestamp":"<Unix seconds>","bids":[{"price":"...","quantity":"..."}],"asks":[...]}}`, about 4.1 KB at level 0 | P1 |
| level order | bids from best to worst, asks from best to worst | P1 |
| size unit | `quantity` is the base asset, for example BTC | P1, S1 |
| timestamp | Unix seconds as a string, one new value on each of 12 one-second polls, within half a second of local time | P1 |
| freshness | the top of book changed on 7 to 10 of 12 one-second polls across three runs | P1 |
| caching | `Cache-Control: private, must-revalidate`, `pragma: no-cache`, `expires: -1`, no `ETag` | P1 |
| unknown symbol | 200 with empty `bids` and `asks`, no error | P1 |
| quiet pair | `ACH_USDT`, the last catalog row, returned 50 levels per side | P1 |

The documentation's reply example is wrapped in `result` with `state`, while the wire uses `data`, S1 and P1.
CCXT's `fetchOrderBook` sends `level` 0 by default and reads `data`, at `cryptomus.js` lines 246 and 564 to 565, and returned 50 levels per side, P2.
Because an unknown symbol is not an error, a consumer has to check the symbol against the catalog itself.

The trades call `GET /v1/exchange/market/trades/{pair}` returned 50 rows spanning about 2.6 to 2.7 hours, of which 30 had a `null` price, P1.
Its newest BTC_USDT row was 49 seconds old in one run and the same row was 284 seconds old in the next, which is a thin print for a pair the ticker credits with USD 132 million a day, P1.
Its `base_volume` holds the quote amount and `quote_volume` holds the base amount, since price times `quote_volume` equals `base_volume` on the first row, P1.
CCXT already swaps them, at `cryptomus.js` lines 623 and 624.
The first manual call to this path answered nginx 503 "Service Temporarily Unavailable", and every probe run got 200, P1.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published public limit | `Not publicly specified` | S1 |
| CCXT `rateLimit` | 100 ms, marked `// todo check` | `cryptomus.js` line 24 |
| rate limit headers | none on any reply, and no `Retry-After` | P1 |
| status observed for a limit | none, the probe stayed near one request per second and was never limited | P1 |
| validation error | 422 `{"code":0,"message":"Validation failed.","errors":[{"property":"level",...}]}` | P1 |
| signed call without credentials | 422 `{"state":1,"errors":{"userId":[...],"sign":[...]}}` | P1 |
| unknown path | 404 `{"error":"Not found"}` under `/v1/`, an nginx HTML 404 under `/v2/user-api/` | P1 |
| upstream failure | an nginx HTML 503 seen once on the trades path | P1 |

## 7. Server time and clock offset

The venue publishes no server time call, and CCXT sets `fetchTime` to `false` at `cryptomus.js` line 139.
The HTTP `Date` header was 0.25 to 0.69 seconds behind the local clock across three runs, which is inside its one second resolution, P1.
The book `timestamp`, in whole seconds, sat within half a second of local send time on every poll, P1.

## 8. Recommended poller shape

No anchor poller is recommended, because the venue publishes no index, mark or funding.
A future spot leg would load the catalog from `GET /v2/user-api/exchange/markets` with its own tick from `pricePrec`, and could use `GET /v1/exchange/market/order-book/{pair}?level=0` as a 50-level REST snapshot.
It would need a book socket, and none could be reached from this host, see [websocket.md](./websocket.md).

## 9. Source ledger

| id | source |
|---|---|
| S1 | `https://doc.cryptomus.com/methods/market-cap/orderbook`, `/methods/market-cap/tickers`, `/methods/market-cap/trades`, `/methods/exchange/list-of-available-trading-pairs` and `/methods/exchange/get-current-market-price`, retrieved 2026-10-09 |
| S2 | `https://doc.cryptomus.com/methods/exchange/websockets` section "Market list", retrieved 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/cryptomus/rest-probe.py), run 2026-10-10 UTC |
| P2 | [`ccxt-probe.py`](../../../scripts/probes/venues/cryptomus/ccxt-probe.py), CCXT 4.5.68 from PyPI, run 2026-10-10 UTC |
