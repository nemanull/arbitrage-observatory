# Webot REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:37 UTC, from the development host near Seattle.

This profile covers the public spot REST API that serves Webot, formerly Pionex.US, because Webot lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Webot publishes no API documentation, and its sitemap, `llms.txt` and `llms-full.txt` name no API, see [`fees.md`](./fees.md) section 1.
The paths below are those of the Pionex international open API docs, S1 to S4, tried on `https://api.webot.com`, which answered them.
So every "documented" value is Pionex's, for a different venue, and the probed value is what Webot's host does.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/webot/rest-probe.mjs), run three times, P1, P2 and P4, and from `curl` checks, P3.

## 1. Host and latency from this machine

| host | resolved to | front | first request | warm requests |
|---|---|---|---|---|
| `api.webot.com` | `104.18.28.173`, `104.18.29.173` and two IPv6 addresses | Cloudflare, `cf-ray` POP `SEA` in P1, P2 and P4 and `YVR` in P3 | 204, 169 and 169 ms | 63 to 91 ms over fifteen requests |
| `api.pionex.us` | `52.85.129.43`, `.50`, `.81`, `.83` | CloudFront POP `SEA900-P10`, then `APISIX/3.13.0` | 140, 131 and 156 ms | 76 to 132 ms over fifteen requests |
| `ws.pionex.us` | the same four CloudFront addresses | | | see [`websocket.md`](./websocket.md) section 1 |

Both REST hosts serve the same data: the `data` object of `GET /api/v1/common/symbols` was identical on the two in P1, P2 and P4.
`api.webot.com` is the brand's own name for the host, and neither is documented.
The book is not the Pionex international book: at 03:24 UTC `BTC_USDT` read 86,703.66 by 86,706.55 on `api.webot.com` and 86,760.46 by 86,760.47 on `api.pionex.com`, P3.

## 2. Catalog

### The instruments call

`GET https://api.webot.com/api/v1/common/symbols` returns every symbol in one reply of 117,487 bytes in 103 and 106 ms, P1 and P2.
S2 documents the query parameters `symbols` and `type`, which is `SPOT` or `PERP`.

| field | meaning, S2 | probed |
|---|---|---|
| `symbol` | "Trading pair identifier" | `BASE_QUOTE`, for example `BTC_USDT` |
| `type` | `SPOT` or `PERP` | `SPOT` on all 384 rows |
| `baseCurrency`, `quoteCurrency` | | 262 bases, quotes `USD`, `USDT` and `USDC` |
| `basePrecision`, `quotePrecision`, `amountPrecision` | decimal places | `BTC_USDT`: 6, 2 and 8 |
| `minAmount`, `minTradeSize`, `maxTradeSize`, `minTradeDumping`, `maxTradeDumping` | order bounds | `BTC_USDT`: `"5"`, `"0.000001"`, `"9000"`, `"0.000001"`, `"29.33387056"` |
| `buyCeiling`, `sellFloor` | price multiplier bounds | `"1.1"` and `"0.9"` |
| `enable` | "Whether trading is enabled" | `true` on 6 rows only: `BTC_USDT`, `FDP_USDT`, `MSK_USDT`, `NILA_USDT`, `TAB_USDT` and `USDC_USD` |

| quote | symbols | `enable` true | traded in the last 24 h | 24 h quote amount, P1 and P2 |
|---|---:|---:|---:|---:|
| USD | 152 | 1 | | 3,343,573 and 3,363,342 |
| USDT | 218 | 5 | | 6,707,013 and 6,705,911 |
| USDC | 14 | 0 | | 1,229,959 and 1,235,276 |
| all | 384 | 6 | 298 | |

The traded count is the number of rows of `GET /api/v1/market/tickers` with a non-zero `count`, 298 in both passes.
292 of those 298 have `enable` false, so the flag does not mean what S2 says on this host.
It may mark the pairs open to API orders, which is an inference that could not be checked without an API key.
No other status field exists, so a delisted pair is visible only as a pair with no trades and an empty book.
The largest pairs by 24 h quote amount were `USDC_USDT` 2.54 and 2.56 million, `BDX_USD` 1.02 million, `BDX_USDC` 0.97 million, `ZEC_USD` 0.77 million, `ZEC_USDT` 0.72 million and `BTC_USDT` 0.72 and 0.71 million, P1 and P2.
The quote amounts add up to about 11.3 million, which agrees with CoinGecko's 129.7 BTC of 24 h volume, see [`fees.md`](./fees.md) section 1.

`type=PERP` returns `{"result":true,"data":{"symbols":null},…}`, and `type=FUTURES` returns `MARKET_PARAMETER_ERROR` `type error`, P1 and P2.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no class for Webot, Pionex.US or Pionex, and CCXT master at commit `1d8b674` of 2026-09-22 has none either, see [`fees.md`](./fees.md) section 8.
The connector's catalog is `venue.loadMarkets()` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, so Webot has no catalog path into the engine without a hand-written loader.
Were one written, `market.id` would be the `symbol` above, which is exactly what the socket routes on, see [`websocket.md`](./websocket.md) section 3, and `contractSize` would be 1, since spot sizes are in the base currency.

### The USD settlement family and pairs listed twice

109 of the 262 bases are listed against more than one of USD, USDT and USDC, among them `BTC` and `ETH` on all three, P1 and P2.
The engine treats the three quotes as one family and takes one market per pair, so a spot loader would need a `marketFilter` choosing one quote per base.
No price scale applies, since no symbol is quoted per 10 or per 1000 units.

## 3. Anchor

Webot publishes no index price, no mark price and no funding rate, because every market is spot.
No index, reference or benchmark price is named on any Webot page read for this profile, see [`fees.md`](./fees.md) section 10.

The Pionex futures API has the calls an anchor would use, S4.
On `api.webot.com` each of them answered HTTP 404 `{"error_msg":"404 Route Not Found"}` in P1 and P2:

- `/api/v1/market/indexes`, with and without `symbol=BTC_USDT_PERP`
- `/api/v1/market/fundingRates?symbol=BTC_USDT_PERP`
- `/api/v1/market/markKlines` and `/api/v1/market/indexKlines`
- `/api/v1/market/openInterests` and `/api/v1/common/riskTable`
- `/api/v1/market/bookTickers`, which S3 documents for spot, and `/api/v1/market/bookTicker` of S4

`/api/v1/market/tickers?type=PERP` answered `{"tickers":null}`, and `/api/v1/market/depth?symbol=BTC_USDT_PERP` answered `MARKET_INVALID_SYMBOL`.

The one bulk market call is `GET https://api.webot.com/api/v1/market/tickers`, 62,542 and 62,543 bytes with 384 rows, in 45 and 58 ms, P1 and P2.

| field | meaning, S3 | probed |
|---|---|---|
| `symbol` | | the catalog `symbol` |
| `time` | | integer ms, and it changed on 59 and 58 of 59 one second polls of `BTC_USDT`, so it is close to the reply time, not the last trade |
| `open`, `close`, `low`, `high` | 24 h prices | decimal strings |
| `volume`, `amount` | 24 h base and quote volume | decimal strings |
| `count` | 24 h trade count | integer, 0 on 86 rows |

It carries no bid and no ask.
Nothing in it can fill an `AnchorRow`, whose `mark` of 0 refuses a route at open with `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 to 39, and a route with no anchor row at all is refused earlier as `anchor_missing`, at lines 25 to 27.
So a Webot leg could never pass the open gate in the engine's current shape.

## 4. Anchor semantics

None exist, see section 3.
For context, this is how often the public numbers changed across the 59 intervals of each 60 poll run at one poll a second, in P1 and P2.

| number | changed |
|---|---|
| `BTC_USDT` REST book at limit 20, any level | 37 and 44 |
| `BTC_USDT` REST book, best bid or ask price or size | 21 and 25 |
| `BTC_USDT` REST book `updateTime` | 39 and 48 |
| `BTC_USDT` ticker `close` or `count` | 31 and 32 |

The REST book's `updateTime` was 325 and 141 ms old at best, 1,125 and 809 ms at the median and 4,123 and 4,804 ms at worst, against this host's clock, which agrees with the server to about 13 ms, section 7.

## 5. REST book snapshot

`GET https://api.webot.com/api/v1/market/depth?symbol=BTC_USDT&limit=20`, weight 1, S3.

| item | documented, S3 | probed |
|---|---|---|
| depth | `limit` 1 to 1000, default 20 | limits 5, 20 and 100 returned exactly that many levels per side on `BTC_USDT`. Limit 1000 returned 999 bids and 999 asks, 48,081 and 48,084 bytes in 102 and 108 ms. Limits 0 and 1001 returned `MARKET_PARAMETER_ERROR` `limit error`, and `abc` returned `limit must be number` |
| shape | `bids`, `asks` as `[price, size]` strings, `updateTime` | the same, `{"bids":[…],"asks":[…],"updateTime":1790134246324}` |
| level order | bids descending, asks ascending | confirmed at every limit in P1 and P2 |
| number format | | the same price read `"86647.1"` at limits 5 to 100 and `"86647.10"` at limit 1000, in P2 |
| caching | Not publicly specified | `cf-cache-status` `DYNAMIC` and no `cache-control`. Two reads back to back returned identical bodies with one `updateTime` in both passes, and in P2 one `updateTime` held across four reads over about 1.8 s while its age grew from 2,442 to 4,246 ms |
| agreement with the socket | | the last DEPTH 20 frame of `BTC_USDT` equalled this call on all 40 levels in both socket passes, see [`websocket.md`](./websocket.md) section 4 |

Spreads on the pairs checked were wide next to the engine's venues.
`BTC_USDT` read 86,486.48 by 86,532.68 in P1 and 86,647.1 by 86,764.7 in P2, a spread of 46.2 and 117.6 USDT, about 534 and 1,356 ppm of the price.
`BTC_USD` read a spread of 121.2 and 121.52 USD, and `ETH_USDT` 2.17 and 2.60 USDT.
The best bid of `BTC_USDT` in P1 was 0.000008 BTC, well under a dollar.

## 6. Rate limits and errors

| item | documented, S5 | probed |
|---|---|---|
| limit | "All endpoints share the 10 per second limit based on IP", weighted, and the market calls weigh 1 while `common/symbols` weighs 5, S2 and S3 | not tested on purpose. In P1 and P2 the catalog step sent four or five `common/symbols` reads within about a second, about twice the documented budget, and every one answered 200 with no limit header. The probe now keeps its weight at or under 8 in any second, as it did in P4 |
| status on breach | "Exceeding the weight limit results in HTTP 429 status code." | not reached |
| ban | "The violating IP or account receives a 60-second ban.", "Repeated violations extend the ban duration by 10 seconds per additional request." | not reached |
| `Retry-After` or limit headers | Not publicly specified | none on any reply. The headers were `cf-cache-status`, `cf-ray`, `connection`, `content-encoding`, `content-type`, `date`, `expect-ct`, `referrer-policy`, `server`, `set-cookie`, `strict-transport-security`, `transfer-encoding`, `x-content-type-options`, `x-frame-options`, `x-request` and `x-xss-protection` |

Errors come back with HTTP 200 and `result` false, which S6 documents as `{"result": false, "code": "TRADE_INVAILD_SYMBOL", "message": "Invalid symbol", "timestamp": 1566691672311}`.

| request | HTTP | body, P1 and P2 |
|---|---|---|
| `depth?symbol=NOPE_USDT`, no `symbol`, `btc_usdt` or `BTCUSDT` | 200 | `{"result":false,"code":"MARKET_INVALID_SYMBOL","message":"symbol error","timestamp":1790134254}` |
| `depth?symbol=BTC_USDT&limit=abc` | 200 | `MARKET_PARAMETER_ERROR` `limit must be number` |
| `tickers?symbol=NOPE_USDT` | 200 | `MARKET_INVALID_SYMBOL` `symbol error` |
| `common/symbols?symbols=NOPE_USDT` | 200 | `MARKET_PARAMETER_ERROR` `symbol error` |
| `trade/allOrders` without a key | 200 | `{"result":false,"code":"INVALID_APIKEY","message":"no PIONEX-KEY in header"}` |
| `account/balances` without a key | 200 | `{"timestamp":1790134258330,"code":"APIKEY_LOST","message":"Apikey lost","result":false}` |
| an unknown path | 404 | `{"error_msg":"404 Route Not Found"}` |

A market error's `timestamp` is in seconds, while a success reply's is in milliseconds.
The private paths exist behind a key check, which says nothing about whether a Webot user can obtain a key, see [`fees.md`](./fees.md) section 1.

## 7. Server time and clock offset

No time call exists: `/api/v1/common/timestamp` and `/api/v1/common/time` answer 404, P1 and P2.
Every success reply carries `timestamp` in ms.
Against the midpoint of each request, six reads of `tickers?symbol=BTC_USDT` gave offsets of 0 to 7 ms with round trips of 28 to 43 ms in P1, 8 to 13 ms with round trips of 41 to 65 ms in P2, and 2 to 5 ms with round trips of 28 to 31 ms in P4.
The server clock and this host's therefore agree within the round trip.

## 8. Recommended poller shape

None.
Webot publishes no index, mark or funding, so there is nothing to poll for an `AnchorRow`, and the engine's anchor poller has no role here.
If a later design admits spot legs, the book comes from the socket, see [`websocket.md`](./websocket.md) section 8, and the catalog from `GET /api/v1/common/symbols` once at boot, keeping pairs with a non-zero 24 h `count` from `GET /api/v1/market/tickers`.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Pionex docs index | https://www.pionex.com/docs/llms.txt | 2026-09-22 | Pionex, international, not Webot | the page list, section 3 |
| S2 | Pionex Trade API, Common | https://www.pionex.com/docs/api-docs/trade-api/common.md | 2026-09-22 | Pionex, international | symbols call, `type`, `enable`, weight 5, section 2 |
| S3 | Pionex Trade API, Market | https://www.pionex.com/docs/api-docs/trade-api/market.md | 2026-09-22 | Pionex, international | depth, tickers and bookTickers, limits and weights, sections 3 and 5 |
| S4 | Pionex Futures API, Market and Common | https://www.pionex.com/docs/api-docs/futures-api/market.md | 2026-09-22 | Pionex, international | index, funding, mark and open interest paths, section 3 |
| S5 | Pionex Trade API, Rate Limits | https://www.pionex.com/docs/api-docs/trade-api/general-info/rate-limits.md | 2026-09-22 | Pionex, international | 10 per second per IP, 429, ban, section 6 |
| S6 | Pionex Trade API, Basic Info | https://www.pionex.com/docs/api-docs/trade-api/general-info/basic-info.md | 2026-09-22 | Pionex, international | response and error format, section 6 |
| P1 | `rest-probe.mjs main` at 03:12 UTC and `poll` at 03:22 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/webot/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs all` at 03:30 to 03:32 UTC, second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/webot/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7, the second readings |
| P4 | `rest-probe.mjs main` at 03:36 UTC, rerun after the weight limiter was added | [`rest-probe.mjs`](../../../scripts/probes/venues/webot/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7, the same readings as P1 and P2 within the ranges given |
| P3 | `curl` of the candidate hosts at 03:06 UTC, and one `BTC_USDT` depth read on each of `api.webot.com` and `api.pionex.com` at 03:24 UTC | none, commands only | 2026-09-23 UTC | this host | hosts, `YVR` POP, the separate book, section 1 |
