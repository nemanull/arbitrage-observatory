# P2B REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:05 to 03:34 UTC), from the development host near Seattle, in two passes.

This profile covers the public REST API v2 of P2B (CCXT id `p2b`) for its spot market, because P2B lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): section 3 states that P2B publishes no index, mark or funding, and section 8 recommends no anchor poller.
Every measured number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/p2b/rest-probe.mjs) unless a row names `curl`.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST host | `api.p2pb2b.com`, base path `/api/v2/public`, S1 |
| resolved | `172.66.170.54` and `104.20.21.86`, Cloudflare, the same pair as `apiws.p2pb2b.com` and `p2pb2b.com` |
| edge | `cf-ray` ended in `SEA` or `YVR`, so Seattle or Vancouver |
| cache behind the edge | Varnish, with `x-varnish-ttl: 10s`, `x-varnish-grace: 5s`, `x-cache: HIT` or `MISS` and an `age` header |
| cold request | DNS 6 to 23 ms, TCP 14 to 42 ms, TLS 26 to 74 ms, first byte 195 to 443 ms, total 198 to 604 ms, over ten calls in two passes |
| warm request | `tickers` 321 to 376 ms over 60 polls, medians 323 and 367. `depth/result` at 20 levels 167 to 241 ms over 30 polls, medians 168 and 193 |
| access | every public call answered 200 with no geoblock. The website and the fee calls also answered 200, see [`fees.md`](./fees.md) section 1 |

The edge is local, and the first byte waits about 150 to 400 ms more, which is the path to the origin.
The WebSocket ping took 163 and 168 ms the same evening, see [`websocket.md`](./websocket.md) section 3.

## 2. Catalog

### The instruments call

`GET https://api.p2pb2b.com/api/v2/public/markets` returns every market in one reply of 41,923 or 41,924 bytes, S1.

| field | meaning |
|---|---|
| `name` | market id, `BTC_USDT` |
| `stock`, `money` | base and quote |
| `precision` | `money`, `stock` and `fee` decimals |
| `limits` | `min_amount`, `max_amount`, `step_size`, `min_price`, `max_price`, `tick_size`, `min_total`, where "If the limit is equal 0, the limit does not apply", S1 |

The reply carries no status, active flag or product type.
On 2026-09-22 it listed 173 markets, all spot, in both passes.

| quote | markets |
|---|---:|
| USDT | 114 |
| USDC | 29 |
| BTC | 13 |
| USD | 12 |
| ETH | 3 |
| BNB | 2 |
| total | 173 |

125 markets carry a `max_amount` or `max_price` of `"0"`, which means no limit.
The documentation says the reply is cached for about 30 s, S1.

### How CCXT 4.5.68 maps it

| item | CCXT | against the wire |
|---|---|---|
| call | `fetchMarkets` reads `publicGetMarkets`, at `server/node_modules/ccxt/js/src/p2b.js` line 340 | the call above |
| `market.id` | `name`, at line 375 and 384 | equal to the REST `name` and the `tickers` key on 173 of 173 markets, and to the socket's `params[2]` |
| type | `type: 'spot'`, `spot: true`, `swap: false`, at lines 392 to 397 | 173 spot markets, 0 swaps |
| `active` | hard coded `true`, at line 398 | the reply has no status to read |
| `linear`, `contractSize` | `undefined`, at lines 400 and 402 | book sizes are base currency amounts, so the connector's default of 1 is right, see [`websocket.md`](./websocket.md) section 4 |
| precision | `step_size` and `tick_size` as amount and price precision | `BTC/USDT` 0.00001 and 0.01 |
| `loadMarkets` time | 670 and 568 ms, one request | |

The engine's connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, so it would load 0 P2B markets.

### Pairs listed twice and price scale

155 markets are quoted in USD, USDT or USDC, over 114 bases.
37 bases are listed against two or three of those quotes, for example `BTC`, `LTC`, `BNB` and `TRX` against all three.
The quote family would keep one market per base, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
No market is quoted per 10 or per 1000 units.

## 3. Anchor

P2B publishes no index price, no mark price and no funding rate, because it has no derivative.
CCXT agrees: `fetchFundingRate`, `fetchFundingRates` and `fetchFundingRateHistory` are false at `p2b.js` lines 72 to 74, `fetchIndexOHLCV` at line 76, and `fetchMarkPrice` and `fetchMarkPrices` at lines 94 and 95.

The only reference prices are the ticker's `last` and its 24 h `open`, `high` and `low`.

| call | fields | reply | cache |
|---|---|---|---|
| `GET /api/v2/public/tickers` | per market `at` in seconds and `ticker` with `bid`, `ask`, `low`, `high`, `last`, `vol`, `deal`, `change` | 30,661 to 30,679 bytes, 173 rows keyed by market id | documented about 30 s, probed about 10 s |
| `GET /api/v2/public/ticker?market=BTC_USDT` | `bid`, `ask`, `open`, `high`, `low`, `last`, `volume`, `deal`, `change` | 284 and 285 bytes | documented about 30 s, and two cold reads carried `age: 12` and `age: 7` |

Over 30 polls at one second, in each of two passes, the `tickers` `cache_time` changed 3 times, 26 of 29 consecutive bodies were byte for byte identical, and the `BTC_USDT` bid and ask changed 0 and 1 times.
The reply's `cache_time` was 0.32 to 11.20 s older than the local clock at arrival, medians 6.21 and 5.95 s.
In the first pass one `ticker` read showed `BTC_USDT` at 86588.29 and 86588.3 while the `depth/result` read 205 ms later showed 86586 and 86586.01.
In the second pass the two agreed, at 86664.21 and 86664.22, so the gap depends on the cache's age.
So the ticker is not a usable best bid and ask, and there is nothing to map into an `AnchorRow`.

## 4. Anchor semantics

Not applicable.
P2B has no index formula, basket, mark formula, clamp or funding formula, because it has no perpetual.

## 5. REST book snapshot

| call | depth | order | probed |
|---|---|---|---|
| `GET /api/v2/public/depth/result?market=BTC_USDT&limit=100` | limit 1 to 1000, default 500, S1 | bids descending and asks ascending, best first | 100 levels per side in 4,690 or 4,691 bytes, 500 by default in 22,912 to 22,916 bytes, 1000 in 45,671 to 45,676 bytes |
| same, with `interval` | `0`, `0.00000001` to `0.1` and `1`, S1 | best first | interval `1` merged `BTC_USDT` to whole dollars, as on the socket |
| `GET /api/v2/public/book?market=BTC_USDT&side=buy&limit=100` | limit 1 to 100, offset up to 10,000, S1 | best first | one row per resting order, not per level: `id`, `left`, `amount`, `price`, `timestamp`, `side`, `dealStock`, `dealMoney`. `total` was 2,233 buy and 2,165 sell orders in both passes, and `limit=101` was accepted and echoed |

Both calls are documented as cached for about one second, S1.
Over 15 polls at one second of `depth/result` at 20 levels, in each of two passes, `cache_time` changed 6 times, the book changed 4 and 5 times, and `cache_time` was 83 to 2,083 ms older than the local clock at arrival, medians 1,072 and 1,093 ms.
A quiet market's `depth/result`, `CPC_USDT`, held 19 bids and 100 asks in both passes, as its socket snapshot did.
The socket's book matched `depth/result` exactly at 20 levels, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The public API has no published rate limit.
The private API allows "Not more than 10 requests per second", and error 1013 with status 429 marks a breach, S1 and S2.
CCXT spaces requests by `rateLimit: 100`, at `p2b.js` line 23.
No reply carried a rate limit or `Retry-After` header, and the probe stayed at two requests a second or less, so no limit was met.

Every error is a JSON body `{"success": false, "errorCode": <n>, "message": "<text>", "result": []}`.

| request | status | body |
|---|---|---|
| `ticker?market=NOPE_USDT` | 400 | `{"success":false,"errorCode":2021,"message":"Unknown market.","result":[]}` |
| `depth/result?market=NOPE_USDT` | 400 | code 2021 `Unknown market.` |
| `depth/result?market=btc_usdt` | 400 | code 2022 `Market is not available.` |
| `depth/result` with `limit=0` or `limit=1001` | 422 | code 3060 `Invalid limit value` |
| `depth/result` with `interval=0.5` | 422 | code 3110 `Invalid interval value` |
| `book` with `side=nope` | 422 | code 3100 `Invalid side value` |
| `/api/v2/public/nope` | 400 | code 1019 `Route not found.` |

The errors table documents 2020 for "Market is not available.", while the wire answered 2022 for a lowercase market, S2.
Code 1019 is not in the documented table.

## 7. Server time and clock offset

The REST API has no time call.
The WebSocket `server.time` answered 1790133064 at a local time of 1790133064.184 s, and 1790134161 at 1790134161.703 s, so the two clocks agree to within its one second resolution, see [`websocket.md`](./websocket.md) section 6.
The HTTP `Date` header was 805 and 584 ms behind the local clock, which is also inside its one second resolution.
The body's `current_time` is written when the cache fills, and it read 2.73 and 9.23 s behind the local clock, so it is not a clock.

## 8. Recommended poller shape

No anchor poller is recommended.
P2B publishes no index, mark or funding, and a spot leg has no anchor to read.
A spot stage that wanted a REST fallback for the book would use `depth/result`, cached for about one second, and never `tickers`, cached for about ten.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | P2B API documentation | https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md | 2026-09-22 | P2B, global | base URL, calls, limits, caching, private rate limit, sections 1, 2, 3, 5 and 6 |
| S2 | P2B API errors table | https://github.com/P2B-team/p2b-api-docs/blob/master/errors.md | 2026-09-22 | P2B, global | error codes and statuses, section 6 |
| S3 | CCXT 4.5.68 `p2b.js` | `server/node_modules/ccxt/js/src/p2b.js` | 2026-09-22 | CCXT | market mapping, capability flags, `rateLimit`, sections 2, 3 and 6 |
| P1 | `rest-probe.mjs catalog`, `timing`, `depth` and `errors`, 03:19 to 03:21 UTC, and `all` at 03:28 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/p2b/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `curl` of `markets`, `tickers`, `depth/result`, `ticker` and headers, 03:06 to 03:27 UTC | https://api.p2pb2b.com/api/v2/public/markets | 2026-09-23 UTC | this host | resolved addresses, Varnish headers, `ticker` shape, sections 1 and 3 |
| P3 | `ws-probe.mjs book`, `server.time` | [`ws-probe.mjs`](../../../scripts/probes/venues/p2b/ws-probe.mjs) | 2026-09-23 UTC | this host | clock, section 7 |
