# ALP.COM REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:40 to 05:02 UTC, and the second pass 05:04 to 05:20 UTC, from the development host near Seattle, through a VPN exit in Canada.

This profile covers the public REST API v3 of ALP.COM, the former BTC-Alpha, on its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) unless a row names another source.
The documentation's REST base is `https://www.alp.com/api/v3/`, S1.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `www.alp.com`. `alp.com` answers 301 to `https://www.alp.com/`, and `api.alp.com` does not resolve | curl and dig, 2026-09-22 |
| addresses | 104.26.2.214, 104.26.3.214 and 172.67.71.137, plus three Cloudflare IPv6 addresses | `latency`, both runs |
| edge | Cloudflare, `colo=SEA` in the first run and `YVR` in the second, `loc=CA` | `latency`, `/cdn-cgi/trace` |
| first request on a new connection | 10 ms for the edge's own trace, so the edge is a few ms away | `latency`, second run |
| cold request with curl, a new TLS connection each | 413 to 795 ms over six calls | curl at about 04:44 UTC |
| warm request, median of 10 | `/time` 182 and 176 ms, `/ticker` 183 and 179 ms, `/pairs` 182 and 181 ms, `/orderbook` 185 and 179 ms, in the two runs | `latency` |
| warm request, maximum | 203 ms over 80 requests | `latency` |
| one second polls | `/ticker` median 191 and 180 ms, max 595 and 244 ms. `/currency-rates` median 184 and 221 ms, max 553 and 638 ms, over 60 polls each run | `poll` |
| caching | `cf-cache-status: DYNAMIC`, no `cache-control` and no `age` header | `book` |
| access | every public call answered 200 from this host through the Canadian VPN exit, and nothing was refused for location | all modes |

About 170 ms of every call is the leg from the edge to the origin, since the edge itself answers in about 10 ms.
The WebSocket upgrade reported `cfOrigin;dur=494`, see [`websocket.md`](./websocket.md) section 1.
Where the origin sits is Not publicly specified.

## 2. Catalog

### The instruments call

`GET /api/v3/pairs`, S2, returned 22 pairs in both runs, 11 quoted in USDT and 11 in USDC.
Each row carries `name`, `currency1`, `currency2`, `price_precision`, `amount_precision`, `minimum_order_size`, `maximum_order_size` and `minimum_order_value`.
No row carries a status, an active flag or a type, so a halted or delisted pair cannot be told apart from a live one.
`GET /api/v3/currencies` returned 54 rows of `short_name` and `sign`.
`USDC_USDT` and `USDT_USDC` are the same two currencies listed both ways.

`GET /api/v3/ticker`, S3, returned one row per pair, read at 05:04:55 UTC in the second run:

| pair | bid | ask | spread, ppm | `vol`, base | last trade |
|---|---:|---:|---:|---:|---|
| `ALP_USDT` | 0.00001 | 2.85 | 284,999,000,000 | 0 | no trade, `timestamp` 0 |
| `BTC_USDC` | 86969 | 86970 | 11 | 166.04924216 | 14 s |
| `BTC_USDT` | 86977.39 | 86977.4 | 0 | 159.2079606 | 16 s |
| `DCY_USDT` | 0.001 | 0.00168 | 680,000 | 0 | no trade, `timestamp` 0 |
| `DOGE_USDC` | 0.10289 | 0.10291 | 194 | 7249061.53457393 | 5 s |
| `DOGE_USDT` | 0.0671 | 0.08368 | 247,094 | 1838891.286 | 13 s |
| `ETH_USDC` | 2770.8 | 2771.1 | 108 | 911.77624589 | 18 s |
| `ETH_USDT` | 2770.31 | 2776.16 | 2,112 | 303.2888832 | 4 s |
| `EURQ_USDC` | 1.1606 | 1.16734904 | 5,815 | 0 | no trade, `timestamp` 0 |
| `EURR_USDC` | 0.5996 | 0.6007 | 1,835 | 27567.46704 | 610,558 s |
| `GDDR_USDT` | 0 | 5.9 | none | 0 | no trade, `timestamp` 0 |
| `GRDR_USDT` | 0.01 | 21.6 | 2,159,000,000 | 0 | no trade, `timestamp` 0 |
| `LTC_USDT` | 64.26 | 64.27 | 156 | 10040.57028 | 10 s |
| `TRX_USDC` | 0.3441 | 0.3442 | 291 | 159795.43 | 11 s |
| `TRX_USDT` | 0.3441 | 0.3442 | 291 | 2295973.136 | 7 s |
| `USDC_USDT` | 0.9996 | 1.0002 | 600 | 70602102.28496243 | 22 s |
| `USDQ_USDC` | 0.9975 | 1.0008 | 3,308 | 16.215812 | 17,117 s |
| `USDR_USDC` | 0.3002 | 0.3008 | 1,999 | 142.27584818 | 610,558 s |
| `USDT_USDC` | 0.11000007 | 139.99999959 | 1,271,726,459 | 0 | no trade, `timestamp` 0 |
| `XRP_USDC` | 1.6295 | 1.6296 | 61 | 237062.437 | 11 s |
| `XRP_USDT` | 1.5436 | 1.6508 | 69,448 | 465765.464 | 5 s |
| `ZEC_USDC` | 0 | 0 | none | 0 | no trade, `timestamp` 0 |

15 of 22 pairs reported a nonzero `vol` in both runs.
Two of them, `EURR_USDC` and `USDR_USDC`, had last traded 610,558 s earlier, about seven days, so `vol` is not a rolling 24 h figure on every pair.
Seven pairs, the ones with a `timestamp` of 0, showed no trade at all, and all of them but `EURQ_USDC` have stub or empty books.
CoinGecko tracks 11 of the pairs, S6.

### Book quality

The posted touch of `DOGE_USDT` is not where it trades.
In three reads between 05:17:57 and 05:19:36 UTC it showed the same best ask of 0.08368 for 59,511.5 DOGE, while all 50 of its last 50 trades, spread over 442 to 474 s, printed between 0.10228 and 0.10278, 22 to 23 % above that ask.
Nobody took the ask in those eight minutes, and the same ask stood in every read since 04:40 UTC, see the pair table above.
For the engine this is the phantom cross of [`edge-at-the-touch.md`](../../bestiary/edge-at-the-touch.md): an ask about 19 % below where DOGE trades on this venue, and below its own `DOGE_USDC` book at 0.10289, that no trade touches.
Whether it can be hit was not tested, since that needs an order.

The USDT books of the large assets switch between wide and tight.
`XRP_USDT` read 1.546 to 1.6504 and, 10 s later, 1.6203 to 1.6204.
`ETH_USDT` held a spread of about 1,500 ppm in the first two reads, 2,769.47 to 2,773.67, with 9 of its last 50 trades below that bid, and a spread of 4 ppm in the third.
The same assets quoted in USDC were tight in every read, `BTC_USDC` at 1 to 10 USDC wide.

Buy and sell prints often come in pairs a fraction of a millisecond apart: 11 of 49 consecutive pairs on `DOGE_USDT` in all three reads, 8 on `XRP_USDT`, 6 or 7 on `BTC_USDT`, 3 or 4 on `ETH_USDT` and 0 on `BTC_USDC`.
The 11 distinct trade times seen in full all fell between .374 and .379 or between .874 and .877 of a second, which suggests trades print on a half second grid.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no class for ALP.COM, and CCXT removed its `alp` class on 2026-03-23 after the v1 API it used shut down, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.
The pair `name`, such as `BTC_USDC`, is the symbol that the WebSocket topics and the REST `pair` parameter use, upper case only, see [`websocket.md`](./websocket.md) section 3.
Sizes are base currency on REST and on the socket.

## 3. Anchor

ALP.COM publishes no index price, no mark price and no funding rate, because it lists no perpetual.

The one reference price it does publish is `GET /api/v3/currency-rates`, documented as "valuation rates for all currencies as a map of currency code to rate string", S2.
It returned 243 currencies, with `"BTC": "87114"`, `"USDT": "1"` and `"USDC": "1"`.
It moved slowly and away from the book:

| run | changes of the BTC rate over 59 one second intervals | BTC rate at the 31st poll | `BTC_USDC` bid at the same poll | gap |
|---|---:|---:|---:|---:|
| first, 05:01 UTC | 0 | 87,114 | 87,031 | 954 ppm above the bid |
| second, 05:06 UTC | 1 | 87,114 | 86,904 | 2,416 ppm above the bid |

How the rate is computed and how often it is refreshed are Not publicly specified.
It is a valuation number for the site's balances, not an index, and it cannot anchor anything.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding to describe.

How often the ticker's own numbers changed over the same 59 one second intervals:

| field | first run | second run |
|---|---:|---:|
| `BTC_USDC` bid or ask | 5 | 4 |
| `BTC_USDT` bid or ask | 12 | 7 |
| `ETH_USDC` bid or ask | 6 | 4 |
| `XRP_USDC` bid or ask | 35 | 24 |
| `LTC_USDT` bid or ask | 33 | 22 |
| `BTC_USDC` last | 3 | 4 |

The WebSocket book carries the same numbers at most once a second, see [`websocket.md`](./websocket.md) section 4.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /api/v3/orderbook?pair=BTC_USDC&limit_buy=20&limit_sell=20`, S2 |
| depth | 20 levels a side by default, and 20 at most: `limit_buy` and `limit_sell` of 50, 100 and 1,000 all returned 20, while 5 returned 5, in both runs |
| shape | `{"buy": [{"amount": 1.23966635, "price": 87191}, …], "sell": […]}`, with prices and amounts as JSON numbers |
| level order | `buy` descending and `sell` ascending on every read of `BTC_USDC` and `BTC_USDT`, both runs |
| size | about 1,570 bytes at 20 levels |
| caching | two reads 300 ms apart were byte for byte identical in both runs, which fits a book that changes at most once a second |
| against the socket | equal to the last `market_depth` frame on 40 of 40 levels in 24 of 24 compares, see [`websocket.md`](./websocket.md) section 4 |
| empty and stub books | `ZEC_USDC` returned `{"buy":[],"sell":[]}`. `GRDR_USDT` returned one bid of 1,000 at 0.01 and three asks from 21.6. `ALP_USDT` one bid of 999,991.844 at 0.00001 and seven asks from 2.85 |
| unknown pair | 400 `{"code":"BAD_REQUEST","message":"pair not found"}` |

## 6. Rate limits and errors

No rate limit is published.
The error table of S4 lists 429 `TOO_MANY_REQUESTS` "Rate limit exceeded" and names no window, no weight and no `Retry-After`.
The probe stayed at two requests a second at most, saw no 429, and so saw no `Retry-After`.
`robots.txt` disallows `/api/` to crawlers, which is not a rate limit.

| request | status | body |
|---|---|---|
| `GET /api/v3/orderbook?pair=NOPE_USDT` | 400 | `{"code":"BAD_REQUEST","message":"pair not found"}` |
| `GET /api/v3/orderbook` | 400 | `{"code":"BAD_REQUEST","message":"pair parameter is required"}` |
| `GET /api/v3/ticker?pair=NOPE_USDT` | 400 | `{"code":"BAD_REQUEST","message":"pair not found"}` |
| `GET /api/v3/nope`, and `GET /api/v3/futures` | 401 | `{"code":"UNAUTHORIZED","message":"missing or invalid Authorization header"}` |
| `GET https://www.alp.com/api/v1/pairs/`, the retired v1 API | 404 | `Not Found` |
| `GET https://btc-alpha.com/api/v1/pairs/` | 301 | redirect to `https://www.alp.com/api/v1/pairs/` |

Every error follows the documented shape `{"code": "ERROR_SLUG", "message": "…"}`, S4.
An unknown path answers 401 rather than 404, so a 401 says nothing about whether a route exists.

## 7. Server time and clock offset

`GET /api/v3/time` returns `{"serverTime":1790138846}`, integer Unix seconds, S2.
Five reads in each run gave the server's second minus this host's midpoint as −0.923 to −0.585 s and then −0.812 to −0.313 s, which is what a clock truncated to the second shows.
Taken together they place the server clock between about 0.31 s behind and 0.08 s ahead of this host, before the uncertainty of a 180 ms round trip.
The `Date` header agreed to the second.
`GET /api/v3/trades` carries finer times, such as `1790140675.374099`, so trade times have microsecond resolution while the ticker, the clock and the socket carry whole seconds.

## 8. Recommended poller shape

None.
ALP.COM publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read.
`currency-rates` is not a substitute, see section 3.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ALP.COM API v3, Introduction | https://docs.alp.com/introduction | 2026-09-22 | ALP.COM, global | base URL, retirement of v1, section 1 |
| S2 | ALP.COM API v3, Server Time & Currency Rates, Currencies & Pairs, Orderbook, Charts & Trades | https://docs.alp.com/server-time-and-rates, https://docs.alp.com/currencies-and-pairs, https://docs.alp.com/orderbook, https://docs.alp.com/charts-and-trades | 2026-09-22 | ALP.COM, global | calls, parameters and shapes, sections 2, 3, 5 and 7 |
| S3 | ALP.COM API v3, Tickers | https://docs.alp.com/tickers | 2026-09-22 | ALP.COM, global | ticker fields, section 2 |
| S4 | ALP.COM API v3, Error Format | https://docs.alp.com/error-format | 2026-09-22 | ALP.COM, global | error shape and 429 slug, section 6 |
| S5 | ALP.COM `robots.txt` | https://www.alp.com/robots.txt | 2026-09-22 | ALP.COM | `/api/` crawler rule, section 6 |
| S6 | CoinGecko exchange `btc_alpha` | https://api.coingecko.com/api/v3/exchanges/btc_alpha | 2026-09-22 | CoinGecko | 11 tracked pairs, section 2 |
| P1 | `rest-probe.mjs ccxt`, `catalog`, `book`, `errors` and `clock` at 04:47 UTC, `latency` at 05:00 UTC and `poll` at 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | `rest-probe.mjs all`, the second pass, 05:04 to 05:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7, the second readings and the pair table |
| P3 | `rest-probe.mjs quality`, three runs at 05:17:57, 05:18:06 and 05:19:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | book quality and trade times, sections 2 and 7 |
