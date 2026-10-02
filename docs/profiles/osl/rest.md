# OSL REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, three runs of `main` and `global` and two of `poll` between 21:41 and 22:09 UTC.

This profile covers the public REST API of OSL HK spot at `https://trade-hk.osl.com`, which is the researched product, see [`fees.md`](./fees.md) section 3.
OSL HK serves two public REST versions, the current v5 under `/api/v5` and the legacy v4 under `/api/v4`, and both are recorded.
The OSL Global host `https://api.osl.com` is recorded in shorter sections, because its perpetuals are delisted and its spot volume is small, 0.219 BTC a day on `BTCUSD`.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/osl/rest-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-22 |
|---|---|---|
| `trade-hk.osl.com` | OSL HK REST, "Production Endpoint", S1 | CNAME `trade-hk.osl.com.cdn.cloudflare.net`, A `104.17.165.193` and `104.17.166.193` |
| `stream-hk.osl.com` | OSL HK v5 WebSocket, see [`websocket.md`](./websocket.md) | CNAME `stream-hk.osl.com.cdn.cloudflare.net`, the same two addresses |
| `api.osl.com` | OSL Global REST, S9 | CNAME `api.osl.com.cdn.cloudflare.net`, the same two addresses |
| `stream-api.osl.com` | OSL Global WebSocket, S9 | CNAME `stream-api.osl.com.cdn.cloudflare.net`, the same two addresses |

Every reply came through Cloudflare, with `cf-ray` colos `SEA` and `YVR`, so the addresses say nothing about where the origin runs.
The v5 replies carry `x-response-time` of 0 to 3 ms and `x-envoy-upstream-service-time` of 1 to 4 ms, while the whole request took about 200 ms.
So nearly all of the time is spent between the Cloudflare edge and the origin, which is an inference and fits an origin in Hong Kong.

Latency with Node `fetch` over a kept connection, one request per second.
The first request of each process, `/api/v5/symbols` in the third `main` run, took 333 ms including DNS, TCP and TLS.

| call | warm min / median / max ms, runs 1, 2, 3 | reply bytes | content-encoding |
|---|---|---:|---|
| `GET /api/v5/symbols` | 217 / 222 / 238, 214 / 222 / 234, 219 / 331 / 710 | 21,238 | none, and no `content-type` |
| `GET /api/v5/book/ticker` | 202 / 207 / 215, 198 / 211 / 223, 202 / 206 / 208 | 4,177 to 4,198 | none |
| `GET /api/v5/order/depth?symbol=BTCUSD&limit=20` | 203 / 208 / 212, 198 / 214 / 217, 193 / 208 / 222 | about 1,020 | none |
| `GET /api/v4/instrument` | 213 / 221 / 224, 214 / 219 / 226, 215 / 232 / 621 | about 11,990 | br |
| `GET /api/v4/orderBook/L2?symbol=BTCUSD&depth=20` | 203 / 209 / 215, 195 / 211 / 214, 198 / 223 / 295 | about 1,015 | gzip or br |

Node sent `accept-encoding`, and the v5 replies still came back uncompressed and without a `content-type` header.
These are one host on one date.

## 2. Catalog

### The instruments call

`GET /api/v5/symbols` returns every pair in one array, "No authentication required", with an optional `symbol` filter, S2.

| item | documented, S2 | probed in all three runs |
|---|---|---|
| rows | "returns all trading pairs available to the user" | 45 |
| `status` | "Publish status: 1 published, 0 unpublished" | `"1"` on 22, `"0"` on 23 |
| quote of the published pairs | | USD 9, HKD 9, USDT 2, USDC 1, USDGO 1 |
| `retailAvailable` | "Available to retail users" | `true` on 7 published pairs: `BTCUSD`, `ETHUSD`, `SOLUSD`, `LINKUSD`, `BTCHKD`, `ETHHKD`, `SOLHKD` |
| `piAvailable` | the schema says "Available to institutional users" | `true` on 22 of 22 published pairs |
| fee fields | `takerFeeRate` "Default taker fee rate", `makerFeeRate` | see [`fees.md`](./fees.md) section 4 |
| other fields | | `symbol`, `baseAsset`, `quoteAsset`, `tickSize`, `stepSize`, `minAmount`, `minQuantity`, `limitMaxAmount`, `limitMaxQuantity`, `marketMaxAmount`, `marketMaxQuantity`, `filters` |

The 22 published pairs are `AVAXHKD`, `BTCHKD`, `BTCUSD`, `BTCUSDGO`, `ETHHKD`, `ETHUSD`, `LINKUSD`, `LTCUSD`, `POLHKD`, `RLUSDHKD`, `SEIUSD`, `SOLHKD`, `SOLUSD`, `TRXHKD`, `TRXUSDT`, `UNIUSD`, `USDGOHKD`, `USDGOUSD`, `USDGOUSDC`, `USDGOUSDT`, `USDTHKD` and `USDTUSD`.
`GET /api/v5/book/ticker` and `GET /api/v4/instrument` each returned exactly those 22, and the v4 reply carries the same `retailAvailable` and `piAvailable` flags.
Sample values for `BTCUSD`: `tickSize` `"0.1"`, `stepSize` `"0.0000001"`, `minAmount` `"1"`, `limitMaxAmount` `"600000"`.

### How the engine's catalog would map it

There is no CCXT class, see [`fees.md`](./fees.md) section 8, so the engine's catalog, `loadMarkets` filtered to active swaps at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68, 79 and 196 to 203, returns nothing for OSL.
A spot catalog would have to be read from `/api/v5/symbols` directly.

| item | value |
|---|---|
| market id | `symbol`, for example `BTCUSD`, spelled the same in the v5 and v4 REST replies, the v5 socket `instId` and the v4 socket `symbol` |
| base and quote | `baseAsset` and `quoteAsset` |
| size unit | base currency, so a contract size of 1, see [`websocket.md`](./websocket.md) section 4 |
| active | `status === "1"` |
| pairs one quote family would hold twice | `USDGOUSD`, `USDGOUSDC` and `USDGOUSDT` fold into one pair under [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6. No other base has two quotes in the USD, USDC and USDT family, and `BTCUSDGO`, `TRXHKD` and the other HKD pairs stay outside it |
| price scale | none needed, prices are per coin |

The v4 `instrument` reply adds a price band.
`minPrice` and `maxPrice` sit symmetrically around a reference price, and on 22 of 22 pairs the half-width equalled the pair's `TAKER_PRICE_RATE` filter.
The half-width is 5 % on the five BTC and ETH pairs, 3 % on `USDTUSD`, `USDTHKD`, `RLUSDHKD`, `USDGOHKD` and `POLHKD`, and 10 % on the other twelve.
That reference equalled the last trade on 1 of 22 pairs and lay inside the spread on 9 of 22, in the third run.

### OSL Global catalogs

| call | rows on 2026-09-22 | note |
|---|---:|---|
| `GET /openapi/v1/spot/public/symbols` | 44: 43 `online`, 1 `offline` | wrapped in `{"code": "00000", "msg": "success", "data": [...]}`, quote USD 31, USDT 7, USDC 5 among the online rows |
| `GET /openapi/v1/spot/market/tickers` | 13 | `BGBUSD`, `BTCUSD`, `BTCUSDT`, `ETHUSD`, `ETHUSDT`, `PLUMEUSD`, `POLUSD`, `USDCUSD`, `USDGOUSD`, `USDGOUSDC`, `USDGOUSDT`, `USDTUSD`, `USDTUSDC` |
| `GET /openapi/v1/symbols`, perpetuals | 25, `marginAsset` `USDC` on all | `allowTrade` 0 on 24, `banOpenPositionStatus` 1 on 23. 21 return frozen books from July, `BTCUSDC` and `TONUSDC` return empty books, `SHIBUSDC` and `PEPEUSDC` return no book |

The perpetual rows are the delisted family of [`fees.md`](./fees.md) section 3.

## 3. Anchor

OSL HK spot publishes no index, no mark and no funding rate, and no call in the HK reference pages read, S1 to S8, returns one.
The reference prices it does publish are the last trade, as `lastPrice` in `GET /api/v5/book/ticker` and as `price` ("Latest price") in `GET /api/v5/order/depth`, the v4 `instrument` fields `lastPrice` and `prevClosePrice`, and the price band of section 2.
None of those is an index of other venues.
This profile recommends no anchor poller for OSL HK.

OSL Global publishes `GET /openapi/v1/price`, "mark price, index price, and last trade price", for every perpetual in one call, S9.

| field | wire on 2026-09-22 |
|---|---|
| `markPrice`, `indexPrice` | live on `BTCUSDC` and `SHIBUSDC` only, with `markPrice` equal to `indexPrice` on `BTCUSDC` |
| `tradePrice` | `"75518.4"` on `BTCUSDC`, the last trade before its delisting, and empty on `SHIBUSDC` and `PEPEUSDC` |
| `time` | the current second on `BTCUSDC` and `SHIBUSDC`, and 2026-07-13 10:39 UTC or earlier on the other 23 |

No funding rate, interval or next settlement is in that call.
The socket's `!markPrice@arr` carries them, see [`websocket.md`](./websocket.md) section 9.
Every perpetual is delisted, so this call cannot anchor anything.

## 4. Anchor semantics

Not applicable to OSL HK spot.
For the record, S10 describes the OSL Global mark only as a price that "should neither be overly sensitive to reflect market changes nor excessively insensitive to them", with no formula, clamp or basket.

## 5. REST book snapshot

| item | v5 `GET /api/v5/order/depth`, documented, S4 | v5 probed | v4 `GET /api/v4/orderBook/L2`, documented, S5 | v4 probed |
|---|---|---|---|---|
| depth | `limit` "default 100, max 1000" | `limit=20` gave 20 and 20. `limit=100` gave 100 bids and 54 to 61 asks. `limit=1000` gave the whole book, 116 to 119 bids and 54 to 61 asks. `limit=1001` answered 200 with the same whole book, not an error | `depth` "Order book depth per side. Send 0 for full depth", default `"25"` | `depth=20` gave 20 and 20. `depth=0` gave 116 to 119 bids and 59 to 61 asks |
| order | not documented | bids descending and asks ascending at every limit | not documented | bids descending and asks ascending |
| id | `lastUpdateId` "Last update ID" | a string, for example `"2172533832"`. It moved backwards once between two reads 1.2 s apart in the second `main` run, and not in the 29 steps of the second `poll` run | none | none |
| timestamp | none | none | `updateTime` | ISO time 97 to 187 ms after the local send time on every poll read, so it is the reply's generation time and not the book's last change |
| sizes | strings | strings with trailing zeros removed, 0 to 7 decimals, where the sockets pad to 8 or 9 | strings | the same as v5 |
| extra field | `price` "Latest price" | the last trade | | |
| time | | medians 206 to 214 ms over the `main` and `poll` runs, and single reads up to 726 ms | | medians 203 to 223 ms, and single reads up to 295 ms |

Over 30 polls at one per second, the v5 `lastUpdateId` changed on 25 and 24 of 29 steps, and the v5 top of book equalled the v4 top on 30 of 30 reads in both runs.
The bulk ticker's `bid` and `ask` equalled the depth reply's best levels on only 18 and 19 of 30 reads, so the ticker is not a book source.
Two depth reads 150 ms apart returned the same id and body twice and different ids once, and every reply read `cf-cache-status: DYNAMIC`, so no edge cache showed.
The recommended socket delivers its own snapshot, so no REST book is needed, see [`websocket.md`](./websocket.md) section 8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| v5 limit | 1,800 weight per minute per IP, 1 weight per call, public calls count against the IP only, S6 | `x-sapi-used-ip-weight-1m` rose by one per v5 call, for example `3` to `8` over six calls, and reached 60 at most. No limit was reached |
| v4 limit | "For all V4 endpoints, we limit requests to 200 requests per second for each IP", S7 | v4 replies carry no usage header |
| v3 limit | 30 requests per second per IP, S7 | not probed |
| status on limit | 429, and 418 for a 60 s ban after 50 rejections in a minute, S6 | not reached |
| `Retry-After` | "Both responses include a `Retry-After` header (in seconds)", S6 | absent on every reply read |

The engine's poller pauses on 403, 418 and 429 and honours `Retry-After`, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1 and [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 238, which matches what S6 documents.

| request | status | body |
|---|---:|---|
| v5 `order/depth?symbol=NOPEUSD` | 200 | `{"code":-1107,"msg":"symbol not exist"}` |
| v5 `order/depth?symbol=XRPUSD`, an unpublished row | 200 | `{"code":-100011,"msg":"Not supported symbols"}` |
| v5 `order/depth` without `symbol` | 500 | `{"code":500,"msg":"java.lang.IllegalArgumentException: Missing argument 'symbol' for method parameter of type String"}` |
| v5 `symbols?symbol=NOPEUSD` and `book/ticker?symbol=NOPEUSD` | 200 | `{"code":-1107,"msg":"symbol not exist"}` |
| v5 `book/ticker?symbol=XRPUSD` | 200 | `{"code":-100011,"msg":"Not supported symbols"}` |
| v4 `orderBook/L2?symbol=NOPEUSD` | 400 | `{"error":{"message":"symbol 'NOPEUSD' is not supported or does not exist","name":"INVALID_SYMBOL"}}` |
| v4 `orderBook/L2?symbol=XRPUSD` | 400 | `{"error":{"message":"symbol 'XRPUSD' is not supported or does not exist","name":"INVALID_SYMBOL"}}` |
| v4 `instrument?symbol=NOPEUSD` | 200 | `[]` |
| Global `spot/market/orderbook?symbol=NOPEUSD` | 400 | `{"code":"40019","msg":"Parameter UnifiedAccountDepthQueryCache(symbol=NOPEUSD, limit=150, brokerId=0, spotDepthTypeEnum=STEP0) cannot be empty",…}` |
| Global `depth?symbol=NOPEUSDC` | 200 | `{"code":-1107,"msg":"symbol not exist"}` |
| Global `commissionRate` without a key | 200 | `{"code":-1001,"msg":"Header access-key is required."}` |

v5 reports most errors inside an HTTP 200 body, so a poller must read `code` as well as the status.

## 7. Server time and clock offset

`GET /api/v5/time` answers `{"serverTime": 1790114057342}` in Unix milliseconds, although none of the v5 pages read lists it.
With a 202 ms round trip the local clock minus the server clock lay between −106 and +96 ms, and with 204 ms between −100 and +104 ms.
That is consistent with no offset and cannot resolve anything finer than the round trip.
OSL Global's documented `GET /openapi/v1/time`, S9, bounded the offset between −206 and +68 ms over three runs.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| anchor poller | none | OSL HK spot publishes no index, mark or funding, and OSL Global's perpetuals are delisted |
| catalog | `GET /api/v5/symbols`, keep `status === "1"` | one call, 21 KB, the published set equals the ticker and v4 sets |
| catalog refresh | on start, and daily | the set changes by announcement |
| errors | treat a 200 with a numeric `code` as an error | section 6 |
| rate limit pause | honour `Retry-After`, 60,000 ms without it | S6 documents a 60 s ban |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Environments and API Summary | https://osl.com/reference/environments.md and https://osl.com/reference/api-summary.md | 2026-09-22 | OSL HK | production host, section 1 |
| S2 | Query Trading Pair Configuration, `/api/v5/symbols`, updated 2026-08-18 | https://osl.com/reference/get_api-v5-symbols.md | 2026-09-22 | OSL HK | catalog fields and `status` values, sections 2 and 3 |
| S3 | Best Bid/Ask Ticker Data, `/api/v5/book/ticker` | https://osl.com/reference/get_api-v5-book-ticker.md | 2026-09-22 | OSL HK | ticker fields, section 3 |
| S4 | Order Book Depth Data, `/api/v5/order/depth` | https://osl.com/reference/get_api-v5-order-depth.md | 2026-09-22 | OSL HK | depth limits and fields, section 5 |
| S5 | Get Order Book, `/api/v4/orderBook/L2`, updated 2026-08-19 | https://osl.com/reference/get-order-book.md | 2026-09-22 | OSL HK | v4 depth parameter, section 5 |
| S6 | V5 Rate Limits | https://osl.com/reference/rate-limit.md | 2026-09-22 | OSL HK | weight, header, 429 and 418, `Retry-After`, section 6 |
| S7 | Rate Limits, v3 and v4 | https://osl.com/reference/rate-limits.md | 2026-09-22 | OSL HK | v3 and v4 limits, section 6 |
| S8 | Get Currency-Pairs, `/api/v4/instrument` | https://osl.com/reference/get-currency-pairs.md | 2026-09-22 | OSL HK | v4 catalog, section 2 |
| S9 | OSL Global API Introduction, Query Server Time, Query Symbol Price | https://docs.glb.osl.com/reference/overview-osl-global-api.md and https://docs.glb.osl.com/reference/get_openapi-v1-price.md | 2026-09-22 | OSL Global | hosts, time, perpetual price call, sections 1, 3 and 7 |
| S10 | Futures trading rules, OSL Global, 2025-12-30 | https://www.osl.com/en/support/futures-trading-rules | 2026-09-22 | OSL Global | the mark price description, section 4 |
| P1 | `rest-probe.mjs main`, 21:41, 21:53 and 22:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/osl/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.mjs poll`, 21:43 and 22:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/osl/rest-probe.mjs) | 2026-09-22 | this host | section 5 |
| P3 | `rest-probe.mjs global`, 21:42, 21:55 and 22:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/osl/rest-probe.mjs) | 2026-09-22 | this host | sections 2, 3 and 7 |
