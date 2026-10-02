# Luno REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 01:24 to 01:38 UTC, from the development host near Seattle.

This profile covers the public REST API of Luno (CCXT id `luno`) for its spot market, because Luno lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot catalog, no anchor, and no poller.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs), plus a few `curl` and `dig` calls named where they are used.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `https://api.luno.com`, the only server in the OpenAPI document | S1 |
| IPv4 | `104.18.34.135` and `172.64.153.121` | `dig` at 01:24 UTC, P1, P5 |
| IPv6 | `2606:4700:4401::ac40:9979` and `2606:4700:4405::6812:2287` | P1, P5 |
| front | Cloudflare, `server: cloudflare`, `cf-ray` ending `-YVR` or `-SEA` | `curl` headers, P3 |
| first request, `GET /api/1/ticker?pair=XBTUSDT` | 271 and 324 ms, including DNS, TCP and TLS | P1, P5 |
| warm single ticker | 5 requests each run: min 170 and 175, median 178 and 183, max 181 and 206 ms | P1, P5 |
| `curl` breakdown, cold | TCP connect done at 216 ms, TLS done at 232 and 243 ms, first byte of `tickers` at 427 ms | `curl` at 01:24 UTC |
| markets call | 1,948 and 2,007 ms, and 2.29 s to first byte in `curl` | P1, P5, `curl` |

The TLS handshake finished 16 to 27 ms after the TCP connect, so the Cloudflare edge is near, and most of a warm request's 170 ms or more is spent behind the edge.
The 216 ms connect fits `curl` trying IPv6 for its 200 ms happy eyeballs delay before IPv4, which is an inference.
The public calls need no key and no header, S1.
`www.luno.com/en/developers/api` answered 200 to this host, and the help centre `guide.luno.com` answered 403 with a Cloudflare challenge, see [`fees.md`](./fees.md).
No REST call was refused on grounds of region.

## 2. Catalog

### The instruments call

`GET https://api.luno.com/api/exchange/1/markets` returns every market, 33,687 bytes and 145 rows in P1 and P5.

```json
{"market_id":"XBTUSDT","trading_status":"ACTIVE","base_currency":"XBT","counter_currency":"USDT","min_volume":"0.0005","max_volume":"100.00","volume_scale":4,"min_price":"100.00","max_price":"1000000.00","price_scale":4,"fee_scale":8}
```

| item | value | source |
|---|---|---|
| documented `trading_status` | `POST_ONLY`, `ACTIVE`, `SUSPENDED`, `UNKNOWN` | S1, schema `MarketInfo` |
| documented ticker `status` | `ACTIVE`, `POSTONLY`, `DISABLED`, `UNKNOWN`, spelled differently from the market status | S1, schema `Ticker` |
| probed | 145 of 145 `ACTIVE` in both runs | P1, P5 |
| perpetuals | none, and no market id looks like a contract | P1, P5 |
| by quote | 51 `MYR`, 25 `ZAR`, 14 `USDT`, 14 `NGN`, 13 `XBT`, 8 `IDR`, 4 `KES`, 4 `UGX`, 4 `AUD`, 2 `USDC`, 2 `GBP`, 2 `ZARU`, 1 `ADA`, 1 `XRP` | P1, P5 |
| bases | 55 distinct | `jq` on the catalog at 01:25 UTC |

### How CCXT 4.5.68 maps it

| field | CCXT | probed |
|---|---|---|
| `id` | `market_id`, read at `server/node_modules/ccxt/js/src/luno.js` line 527 and set at line 534 | equal to REST `market_id` and to ticker `pair` on 145 of 145, and the stream takes the same id in its URL, see [`websocket.md`](./websocket.md) section 3 |
| `symbol` | `base + '/' + quote`, line 535, with `XBT` mapped to `BTC` by `commonCurrencies` at `server/node_modules/ccxt/js/src/base/Exchange.js` line 2419 | `XBTUSDT` is `BTC/USDT`, and `XBT` was the only renamed code |
| `type` | `'spot'`, `swap` false, lines 542 to 547 | 145 of 145 spot, 0 swaps |
| `active` | `status === 'ACTIVE'`, line 548 | 145 of 145 |
| `linear` | undefined, line 550 | |
| `contractSize` | undefined, line 552 | the engine's `toContractSize` would read it as 1, which is right for a spot volume in the base currency |
| `taker`, `maker` | from the exchange level `fees.trading`, see [`fees.md`](./fees.md) section 8 | 0.001 and 0 |

The connector keeps only active swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203.
So `loadVenue` would find zero markets for Luno and skip the venue, at lines 49 to 52.

### The USD settlement family and pairs listed twice

Under the quote family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), 16 markets fall in the USD family: 14 on `USDT` and 2 on `USDC`.
Two bases are listed twice: `XBTUSDT` and `XBTUSDC`, and `ETHUSDT` and `ETHUSDC`, in P1 and P5.
Most of the 16 are thin, from the tickers read at 01:30 UTC in P2.

| market | 24 h volume, base | bid | ask | spread, ppm |
|---|---:|---:|---:|---:|
| `XBTUSDT` | 8.4951 | 86586.9021 | 86650.8647 | 738 |
| `ETHUSDT` | 205.366147 | 2765.00 | 2768.00 | 1,084 |
| `SOLUSDT` | 1195.6121 | 118.8928 | 119.0611 | 1,414 |
| `XRPUSDT` | 251197.71 | 1.5878 | 1.5906 | 1,761 |
| `LINKUSDT` | 879.91 | 13.0322 | 13.0356 | 260 |
| `BCHUSDT` | 38.9759 | 341.00 | 342.00 | 2,928 |
| `DOGEUSDT` | 147655.00 | 0.102078 | 0.102919 | 8,204 |
| `BNBUSDT` | 3.4106 | 785.84 | 792.65 | 8,628 |
| `USDCUSDT` | 2209.12 | 0.9982 | 1.0092 | 10,959 |
| `ETHUSDC` | 2.20 | 2749.8501 | 2778.45 | 10,346 |
| `XBTUSDC` | 0.00 | 86196.9601 | 86929.2498 | 8,459 |
| `PAXGUSDT` | 0.00023 | 4399.01 | 4450.00 | 11,524 |
| `TRXUSDT` | 25.00 | 0.3218 | 0.3574 | 104,829 |
| `XLMUSDT` | 21.02 | 0.21 | 0.22 | 46,511 |
| `ADAUSDT` | 0.00 | 0.2301 | 0.2883 | 224,537 |
| `INJUSDT` | 0.00 | 4.80 | 8.00 | 500,000 |

The spread is the ask minus the bid over their mean.
The `XBTUSDT` spread was 19.35 USDT, about 224 ppm, in the second pass ticker at 01:37 UTC in P6, so it moves a lot between reads.
The `GBP` and `AUD` markets had 0 volume and books like `ETHAUD` with bid and ask `"0.00"`, which is how the ticker writes an empty side.

## 3. Anchor

Luno publishes no index price, no mark price and no funding rate for any market, because every market is spot.
No call in the OpenAPI document returns one, S1, and CCXT marks `fetchFundingRate`, `fetchFundingRates`, `fetchIndexOHLCV` and `fetchMarkOHLCV` false for `luno`, at `server/node_modules/ccxt/js/src/luno.js` lines 61, 63, 65 and 81.
The only index Luno names is the Luno Blue Chip+ index, "a proprietary rules-based, market capitalization-weighted index" of two coins and seven US tokenised stocks behind its Bundles product, S3.
It is not a reference price for any exchange market.

The one bulk market call is `GET https://api.luno.com/api/1/tickers`.

| field | meaning | probed |
|---|---|---|
| `pair` | `market_id` | 145 rows in every one of 120 polls |
| `bid`, `ask` | best bid and ask, decimal strings, `"0.00"` for an empty side | |
| `last_trade` | last trade price | |
| `rolling_24_hour_volume` | base currency | |
| `status` | `ACTIVE` on every row | |
| `timestamp` | "Unix timestamp in milliseconds of the tick", S1 | the time of the last change to that book, not the reply time. `SOLXRP` kept one value through each 60 poll run and read up to 76 s and 221 s old |

The reply was 21,960 to 21,977 bytes.
Nothing in it can fill an `AnchorRow`, whose `mark` of 0 refuses a route at open with `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 36 to 38, and a route with no anchor row at all is refused earlier as `anchor_missing`, at lines 25 to 27.
So a Luno leg could never pass the open gate in the engine's current shape.

## 4. Anchor semantics

None exist, see section 3.
For context, this is how often the ticker fields changed across the 59 intervals of each 60 poll run at one poll a second, in P2 and P6.

| pair | `bid` | `ask` | `last_trade` | `timestamp` |
|---|---|---|---|---|
| `XBTUSDT` | 42 and 7 | 32 and 43 | 0 and 1 | 55 and 57 |
| `ETHUSDT` | 4 and 0 | 3 and 7 | 0 and 0 | 17 and 31 |
| `SOLUSDT` | 6 and 6 | 59 and 59 | 0 and 0 | 59 and 59 |
| `XBTZAR` | 14 and 54 | 23 and 59 | 2 and 0 | 59 and 59 |
| `USDTZAR` | 0 and 0 | 0 and 0 | 0 and 0 | 59 and 58 |
| `SOLXRP` | 0 and 0 | 0 and 0 | 0 and 0 | 0 and 0 |

`USDTZAR` moved its `timestamp` on almost every poll with no change at the touch, which fits a book that changed below the best level.
The ticker `timestamp` read 151 ms old at best and 379 to 432 ms at the median over the six pairs, in P2 and P6.

## 5. REST book snapshot

| call | depth | order | aggregation | probed |
|---|---|---|---|---|
| `GET /api/1/orderbook_top?pair=` | "the best 100 `bids` and `asks`", S1 | bids descending, asks ascending, S1 | "Multiple orders at the same price are aggregated.", S1 | `XBTUSDT` 100 bids and 77 or 76 asks in 12.2 to 12.3 KB, `ETHUSDT` 27 and 85 or 86, `XBTZAR` 100 and 100 in 14.2 KB, `SOLXRP` 24 and 10, in 175 to 333 ms. Order held on all eight reads |
| `GET /api/1/orderbook?pair=` | all | same | "Multiple orders at the same price are not aggregated.", S1 | `XBTUSDT` 164 and 99 orders, then 161 and 98. `XBTZAR` 17,178 bids and 1,427 asks in 967,620 bytes and 602 ms, then 17,172 and 1,428 in 331 ms. Each entry is `{price, volume}` with no order id |

Both carry `timestamp`, the time of the book's last change.
A quiet book's `timestamp` also moves at each five minute mark with no change at the touch: `SOLXRP` read 01:25:01.161 in its book in P1 and 01:30:01.228 in its ticker in P2, and `PAXGUSDT` and `ETHAUD` read 01:30:00.562 and 01:35:01.388 on the stream, see [`websocket.md`](./websocket.md) section 4.
It read 114 ms and 5.3 s old on `XBTUSDT`, 4.3 and 11.7 s on `ETHUSDT`, and 174 and 293 s on `SOLXRP`, in P1 and P5.
Prices and volumes come with 18 decimals, as in `"86592.863600000000000000"`.

Every reply carried `cache-control: public, max-age=1`, `cf-cache-status: DYNAMIC` and no `age` header.
The changelog of 2018-07-16 says "Market data may be cached for up to 1 second.", S1.
Two `orderbook_top` reads of `XBTUSDT` 172 ms apart were byte identical in P1, and two reads 190 ms apart carried different timestamps in P5, so the edge did not pin the reply for a second.
The engine holds 20 levels per side, so `orderbook_top` covers it, and the stream is the better source anyway, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented | "APIs are rate limited to 300 calls per minute. Calls made in excess of this limit will receive a HTTP error `Code 429` response." | S1 |
| changelog, 2018-07-16 | "Rate limits for market data have been increased to 1 per second." | S1 |
| headers on every 200 and 400 reply | `x-ratelimit-limit: 5000, 5000;w=1`, `x-ratelimit-remaining: 4999`, `x-ratelimit-reset: 1` | P1, P2, P5, P6 |
| `Retry-After` | never seen, and no 429 was provoked | P1 to P6 |
| CCXT | `rateLimit: 200` ms, at `luno.js` line 24, and `ErrTooManyRequests` mapped to `RateLimitExceeded` at line 309 | S2 |

The headers advertise 5,000 requests per one second window, which is far above the documented 300 a minute.
Which one the origin enforces is Not verified, and a poller should stay under 300 a minute.
The busiest probe loop ran one request a second.

| request | status | body |
|---|---|---|
| `orderbook_top?pair=NOPEUSDT` | 400 | `{"error":"Market not available","error_code":"ErrMarketUnavailable"}` |
| `ticker?pair=NOPEUSDT` | 400 | the same |
| `orderbook_top` without `pair` | 400 | the same |
| `tickers?pair=NOPEUSDT` | 200 | `{"tickers":[]}` |
| `/api/1/nope` and `/api/1/time` | 404 | empty, and no rate limit headers |

Every error body is `{"error", "error_code"}`, which CCXT's `handleErrors` reads at `luno.js` lines 1599 to 1611.

## 7. Server time and clock offset

Luno has no server time call, and `GET /api/1/time` answered 404 in P1 and P5.
The HTTP `Date` header has a resolution of one second.
It read 438 ms behind to 28 ms ahead of the local request midpoint in P1, and 770 to 286 ms behind in P5, which a one second floor explains without any offset.
On the stream, arrival time minus the frame `timestamp` was 86 to 93 ms at its minimum, see [`websocket.md`](./websocket.md) section 3.
That is about half the 175 ms REST round trip, so the server clock sits within a few tens of milliseconds of this host, but the one way latency and the offset cannot be separated.

## 8. Recommended poller shape

None.
Luno publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read.

| item | recommendation | reason |
|---|---|---|
| anchor poller | do not build one | no anchor field exists, section 3 |
| catalog | `loadMarkets` through CCXT only if spot legs are ever admitted | the connector skips a venue with no swap market today |
| top of book fallback | `GET /api/1/tickers` gives bid and ask for all 145 markets in one 22 KB reply in about 216 to 237 ms at the median | a cheap cross check for a stream feed, not an anchor |
| rate limit pause | if anything polls, pause 60 s on 429 | the documented window is a minute and no `Retry-After` was seen |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Luno API documentation, OpenAPI 1.2.5 embedded in the page: "Rate Limiting", "Market", "Changelog", schemas `MarketInfo` and `Ticker` | https://www.luno.com/en/developers/api | 2026-09-22 | Luno, all regions | host, calls, statuses, depth, caching, rate limit, sections 1 to 7 |
| S2 | CCXT 4.5.68 `luno.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/luno.js` | 2026-09-22 | CCXT | market mapping, error mapping, rate limit, sections 2, 3 and 6 |
| S3 | Luno Blue Chip+ Index Methodology, updated 2026-08-17 | https://guide.luno.com/hc/en-gb/articles/33691976339613, read through `https://guide.luno.com/api/v2/help_center/en-gb/articles/33691976339613.json` | 2026-09-22 | Luno Bundles | the only index Luno names, section 3 |
| P1 | `rest-probe.mjs main` at 01:29 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) | 2026-09-22 | this host | host, catalog, CCXT, book, errors, clock |
| P2 | `rest-probe.mjs poll` at 01:30 UTC on 2026-09-23, 60 polls | [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) | 2026-09-22 | this host | tickers reply, change counts, latency: min 192, median 237, p90 346, max 381 ms |
| P3 | `ws-probe.mjs refusal` at 01:30 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs) | 2026-09-22 | this host | Cloudflare edges, section 1 |
| P5 | `rest-probe.mjs main`, second pass at 01:37 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) | 2026-09-22 | this host | second readings of P1 |
| P6 | `rest-probe.mjs poll`, second pass at 01:37 UTC on 2026-09-23, 60 polls | [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) | 2026-09-22 | this host | second readings of P2, latency: min 176, median 216, p90 322, max 793 ms |
