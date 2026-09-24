# HashKey Global REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:06 to 03:43 UTC on 2026-09-23, the last run of each mode a second pass after the profiles were written, from the development host near Seattle.

This profile covers the public REST API of HashKey Global (CCXT id `hashkey`) at `https://api-glb.hashkey.com`, for its USDT-M perpetuals.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey/rest-probe.mjs), run from `server/`, unless a row names `dig`, `curl` or [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs).
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| resolution | `api-glb.hashkey.com` is a CNAME to `api-glb.hashkey.com.cdn.cloudflare.net` and then to `d6lddq4f82n4h.cloudfront.net`, four addresses in `52.85.129.0/24` | `dig` at 03:06 and 03:34 UTC |
| edge | CloudFront POP `SEA900-P10`, origin `server: openresty`, `x-cache: Miss from cloudfront` on every 200 and `Error from cloudfront` on every 4xx | P1 headers |
| cold request, `GET /api/v1/time` on a new TLS connection | 142, 173, 303, 323, 330 and 352 ms over two runs | P1 |
| warm request, same call | min 107 to 110, median 288 to 293, max 298 to 315 ms over 8, in each of two runs | P1 |
| warm anchor calls at 1 Hz | index median 113 to 117 ms, p90 289 to 295 ms, max 297 to 313 ms over 60. Mark median 113 to 114 ms, p90 287 to 289 ms, max 319 to 330 ms over 120. Two runs | P2 |
| trace header | every reply carries `traceid`, for example `REST:20260923111248259OPENAPI11psBDA` | P1 |

Warm times split into two groups, about 110 ms and about 285 ms, on every call, and the split did not follow the call type.
No reply took longer than 383 ms in any run, the full catalog included.

## 2. Catalog

### The instruments call

`GET /api/v1/exchangeInfo` answered 200 with 112,591 bytes in 383 and 366 ms, S1, P1.
It returns `site` `"BMU"`, `timezone` `"UTC"`, 31 `symbols` (spot), 2 `contracts` (perpetuals), an empty `options` list and 209 `coins`.

| field on each `contracts` row | `BTCUSDT-PERPETUAL` | `ETHUSDT-PERPETUAL` |
|---|---|---|
| `status`, `tradeStatus` | `TRADING`, `TRADABLE` | `TRADING`, `TRADABLE` |
| `underlying`, `quoteAsset`, `marginToken` | `BTC`, `USDT`, `USDT` | `ETH`, `USDT`, `USDT` |
| `index` | `USDT` | `USDT` |
| `inverse` | `false` | `false` |
| `contractMultiplier` | `0.001` | `0.001` |
| `PRICE_FILTER.tickSize` | `0.1` | `0.01` |
| `LOT_SIZE` min, step, max | 0.001, 0.001, 3 | 0.001, 0.001, 40 |
| `riskLimits` | 20 tiers, the first with `initialMargin` 0.02 and `maintMargin` 0.0049 | same shape |

Active perpetual count by settlement asset on 2026-09-23: USDT 2, anything else 0.
The only other status seen is the delisted `BTCUSD-PERPETUAL`, which `exchangeInfo?symbol=BTCUSD-PERPETUAL` answers with 400 `{"code":"-1151","msg":"The trading pair is not open yet"}`, see [`fees.md`](./fees.md) section 3.

### How CCXT 4.5.68 maps it

`fetchMarkets` concatenates `symbols` and `contracts` from the same call, at `server/node_modules/ccxt/js/src/hashkey.js` lines 862 and 863.
`loadMarkets` took 1,754 and 1,728 ms and produced 33 markets, 31 spot and 2 swaps, both active, P1.

| CCXT field | source on the wire | value | evidence |
|---|---|---|---|
| `id` | `symbol` | `BTCUSDT-PERPETUAL`, `ETHUSDT-PERPETUAL` | `hashkey.js` lines 1016 and 1085 |
| `type` swap | the part after `-` is `PERPETUAL` | `swap` | line 1028 |
| `base` | `underlying` | `BTC`, `ETH` | line 1032 |
| `settle` | `marginToken` | `USDT` | line 1019 |
| `symbol` | base, quote and settle | `BTC/USDT:USDT`, `ETH/USDT:USDT` | P1 |
| `active` | `status === 'TRADING'` | `true` on both | line 1038 |
| `linear` | `inverse` false | `true` on both | lines 1041 to 1051 |
| `contractSize` | `contractMultiplier` | `0.001` on both | lines 1058 and 1102 |
| amount precision and minimum | `LOT_SIZE` divided by `contractMultiplier` | 1 contract | lines 1063 to 1067, P1 |

`market.id` equals the socket's `data.s`, the REST mark reply's `symbolId` and the funding reply's `symbol`, character for character, see [`websocket.md`](./websocket.md) section 3.
The index reply is keyed differently, by the index name, see section 3.

### Size unit, pairs listed twice, and price scale

Book sizes on the REST book and on both sockets are integer contracts, and one contract is 0.001 of the base asset, which is CCXT's `contractSize`.
The 24 h ticker of `BTCUSDT-PERPETUAL` reported `v` 16,266 and `qv` 1,399,213.18 USDT, which is 86.02 USDT a unit at a price near 86,400, so a unit is 0.001 BTC, P1.
The best bid of `"12"` against 24 h volume of about 1.4 million USDT only makes sense as 12 contracts, 0.012 BTC.
`LOT_SIZE` is written in base units, 0.001 BTC, while book sizes are in contracts, and CCXT already divides the lot filter by the multiplier.
Each perpetual pair is listed once as a swap, and spot `BTCUSDT` and `ETHUSDT` are separate spot markets that the connector's swap filter drops.
Both contracts are quoted per 1 BTC and per 1 ETH, so no price scale is needed.
Neither ticker names a different token on another venue, so no `DENIED_PAIRS` line is needed.

## 3. Anchor

### The calls

No single call carries all five `AnchorRow` fields.

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /quote/v1/index` | `index[<index name>]` | | | | | 175 to 192 bytes, keys `ETHUSDT`, `BTCUSDT`, `BTCUSD` | median 113 to 117 ms, p90 289 to 295 ms over 60, P2 |
| `GET /quote/v1/markPrice?symbol=<id>` | | `price` | | | | 88 to 91 bytes, one contract | median 113 to 114 ms, p90 287 to 289 ms over 120, P2 |
| `GET /api/v1/futures/fundingRate?timestamp=<ms>` | | | `rate` | absent | `nextSettleTime`, ms as a string | 175 bytes, both contracts | median 282 to 295 ms, max 340 to 345 ms over 6, P2 |
| `GET /api/v1/futures/historyFundingRate?symbol=<id>&limit=100&timestamp=<ms>` | | | settled `settleRate` | 8 h gaps | `settleTime` | 100 rows back to 2026-08-21 | 117 to 303 ms, P1 |

The index call without a symbol returns every index, so it is a bulk call.
The mark call has no bulk form, and without `symbol` it answers 400 `{"code":-100012,"msg":"Parameter symbol [String] missing!"}`, P1.
The funding call without a symbol returns every contract, and without `timestamp` it answers 400 `{"code":"0001","msg":"Required field timestamp missing or invalid"}`, P1.
The documentation's OpenAPI block for the funding call names an `X-HK-APIKEY` header, S2, yet the call answered 200 without any key, and CCXT lists it as public at `hashkey.js` line 205.
So a round costs one index call, one mark call per contract and one funding call, four calls for the two contracts.
`GET /quote/v1/ticker/24hr` carries no mark, index or funding field, and its bulk form lists 41 spot rows and no perpetual, P1.

The undocumented v1 socket topics `index` and `markPrice` push the same index and mark once a second, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbolId` of the mark reply, `symbol` of the funding row | `BTCUSDT-PERPETUAL` | none |
| `index` | `index[underlying + index]` of the index reply, `BTCUSDT` for `BTCUSDT-PERPETUAL` | decimal string, up to 18 decimals | `Number()` |
| `mark` | `price` | decimal string | `Number()` |
| `fundingRate` | `rate` | decimal string, a fraction per 8 h interval: `"0.0001"` is 0.01 % | `Number()` |
| `fundingIntervalHours` | none on the wire | 8, from S3 and the 8 h gaps of every settled row | constant |
| `nextFundingAt` | `nextSettleTime` | ms as a string: `"1790150400000"` is 2026-09-23 08:00 UTC | `Number()` |

The index key is an inference: the contract's `underlying` plus its `index` field gives `BTCUSDT` and `ETHUSDT`, which are the keys the index reply uses.
CCXT's `baseId` plus `quoteId` gives the same two names.
`index?symbol=BTCUSDT-PERPETUAL` answers 200 `{"index":{},"edp":{}}`, so the perpetual's own id finds nothing, P1.

## 4. Anchor semantics

### Index

"A weighted average price index derived from a basket of major spot exchanges, based on their trading volumes", S3.
The basket is published only on the undocumented v1 socket topic `index`, whose `formula` field lists it, P3.

| index | basket on 2026-09-23 03:22 UTC | weights |
|---|---|---|
| `BTCUSDT` | Kraken, Binance, Bybit, Coinbase, OKX | 0.2 each |
| `ETHUSDT` | Binance, OKX, Kraken, Bybit, and Coinbase in some frames | 0.25 each, or 0.2 each when Coinbase is in |
| `BTCUSD`, of the delisted contract | Binance, OKX, Bybit, Gemini, Kraken, Coinbase | one sixth each |

HashKey itself is not in any basket, and S3 describes the constituents as spot exchanges, so the index cannot trail HashKey's own perpetual.
The weights were equal in every frame, which does not match the "based on their trading volumes" wording of S3.
`edp` is "The average of the index for the last 10 minutes", S4.
The socket stamps each index on a whole second and pushed it about every 900 ms, arriving 464 to 1,162 ms after its stamp over two runs, P3.
The REST index changed on 35 and 39 of 59 one-second polls for `BTCUSDT` and 34 and 41 of 59 for `ETHUSDT` in two runs, P2.

### Mark

Since 2025-09-11 the mark is the median of three prices, S5.
Price 1 is the index times (1 + funding rate × hours to the next funding / funding period).
Price 2 is the index plus the 5-minute moving average of the mid minus the index, sampled every 5 seconds.
Price 3 is the last traded price.
No clamp on the mark's premium is named, so the mark can sit as far from the index as the median of the three allows.

| number | `BTCUSDT-PERPETUAL` | `ETHUSDT-PERPETUAL` | evidence |
|---|---|---|---|
| mark minus index over 60 polls, 03:18 UTC | −924 to −855 ppm, median −879 | −610 to −438 ppm, median −548 | P2 |
| mark minus index over 60 polls, 03:35 UTC | −619 to −444 ppm, median −591 | −367 to +55 ppm, median −79 | P2 |
| Price 1 minus index at the 30th poll | +56 and +52 ppm | +58 and +55 ppm | P2, computed from the funding reply |
| changes over 59 intervals | 50 and 45 | 13 and 13 | P2 |
| `time` of the reply | a whole second, in 1,000 ms steps | a whole second, in 1,000 ms steps with one 2,000 ms step | P2 |
| age of the reply's `time` on arrival | 132 to 612 ms | 133 to 1,397 ms | P2 |

Price 1 sat within 60 ppm of the index while the mark sat up to 924 ppm under it, so the mark followed Price 2 or the last price during both polls, which is an inference.
The mark of the delisted `BTCUSD-PERPETUAL` still answers 200, with a price equal to the `BTCUSD` index read a second earlier, to every digit at 03:12 UTC and to one decimal at 03:34 UTC, P1.
An unknown id, and the spot id `BTCUSDT`, answer 200 with an empty body, P1.

### Funding

The formula, interest rate, cap and settlement instants are in [`fees.md`](./fees.md) section 6.
The published `rate` is the one for the upcoming settlement at `nextSettleTime`.
At 03:12 UTC `BTCUSDT-PERPETUAL` published 0.0000966 for 08:00 UTC while its last settled rate, at 00:00 UTC, was 0.0000750, P1.
The rate moved once for `BTCUSDT-PERPETUAL` in 6 reads 10 s apart, in each of two polls, and not at all for `ETHUSDT-PERPETUAL`, which stayed at the 0.0001 interest rate, P2.
The documentation measures the premium every minute, S3, which fits one move a minute.
What the call returns across a settlement instant was not captured.

### How often each number changed

| number | changes in 59 one-second intervals, two runs | evidence |
|---|---|---|
| index `BTCUSDT` | 35 and 39 | P2 |
| index `ETHUSDT` | 34 and 41 | P2 |
| mark `BTCUSDT-PERPETUAL` | 50 and 45 | P2 |
| mark `ETHUSDT-PERPETUAL` | 13 and 13 | P2 |
| funding rate, read every 10 s | 1 and 1 for BTC, 0 and 0 for ETH | P2 |

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /quote/v1/depth?symbol=<id>&limit=<n>` | S1 |
| documented limit | "Maximum value is 200" | S1 |
| levels returned | no `limit`, 200, 201 and 1000 all returned the whole book, 48 to 54 bids and 41 or 42 asks on `BTCUSDT-PERPETUAL` and 78 or 81 bids and 77 or 79 asks on `ETHUSDT-PERPETUAL` over two runs. `limit=20` returned 20 a side | P1 |
| level order | bids descending, asks ascending, at every limit | P1 |
| size unit | integer contracts, section 2 | P1 |
| caching | two reads in a row returned the same bytes and the same `t`, each `Miss from cloudfront` | P1 |
| `t` | the time of the book version served, 82 ms to 4.6 s old on arrival, and once 1.75 s older than the v1 socket's frame | P1, [`websocket.md`](./websocket.md) section 4 |
| merged book | `GET /quote/v1/depth/merged?symbol=<id>&limit=20` answered 200 with 20 levels a side and the same touch as the plain book. With `scale=1` added it answered 200 with no levels | P1 |
| top of book | `GET /quote/v1/ticker/bookTicker?symbol=<id>` answers `{s, b, bq, a, aq, t}`, and without `symbol` 400 `Parameter symbol [String] missing!` | P1 |

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limit for public calls | Not publicly specified per IP. "each API Key has a default rate limit of 2 requests per second for query-related endpoints" | S6 |
| status codes | `429` when a limit is exceeded, `418` when an IP keeps sending after a `429` and "is automatically blocked" | S6 |
| after a `429` on orders | "Please wait 1 minute for the suspended period to expire" | S6 |
| CCXT's throttle | `rateLimit` 100 ms, with `exchangeInfo` at weight 5 | `hashkey.js` lines 24 and 195 |
| observed | 186 requests in 59 s at up to four a second, all 200, no rate limit header and no `Retry-After`, in each of two runs | P2 |
| error shape, quote endpoints | numeric code: `{"code":-100011,"msg":"Not supported symbols"}` with 400 | P1 |
| error shape, `api/v1` endpoints | string code: `{"code":"-1130","msg":"Illegal parameter symbol"}` with 400 | P1 |
| unknown path | 404 with the body `<html><body><h2>404 Not found</h2></body></html>` under `content-type: application/json;charset=UTF-8` | P1 |

## 7. Server time and clock offset

`GET /api/v1/time` answers `{"serverTime":1790132884238}` in ms, and `GET /api/v1/ping` answers `{}`, S1.
The midpoint estimate over 8 warm requests put the server 6 to 108 ms ahead of this host, median 95 ms, in each of two runs, P1.
The sample with the shortest round trip, 108 ms, put it 6 ms ahead, P1.
That suggests the slower replies spend their extra time on one leg, so the median midpoint is a loose bound.
The socket pong, which carries the server's clock, sat 0 to 5 ms from the local midpoint over 12 pings with a 98 to 114 ms round trip, see [`websocket.md`](./websocket.md) section 5.
The clocks agree to within a few milliseconds, and the REST spread is reply time, not clock.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs per round | `https://api-glb.hashkey.com/quote/v1/index`, then `https://api-glb.hashkey.com/quote/v1/markPrice?symbol=<rawMarketId>` for each tracked market, in parallel | the mark has no bulk call |
| funding | `https://api-glb.hashkey.com/api/v1/futures/fundingRate?timestamp=<Date.now()>` every tenth round, and on the first round | the rate moves about once a minute, the settlement time once in 8 h, and it keeps a round at three calls |
| interval | 1,000 ms, the default | median replies of 113 to 117 ms, the mark republishes once a second, and three calls a second ran for 60 s twice without a refusal |
| row mapping | section 3, keyed by `rawMarketId`, with the index looked up under `underlying + index` read once from `exchangeInfo` | the index reply uses the index name |
| `fundingIntervalHours` | 8 for both contracts | the interval is not on the wire |
| skip | a mark reply with an empty body, and a contract whose `status` is not `TRADING` | unknown ids answer 200 with nothing, and a delisted contract still answers a mark |
| rate limit pause | `rateLimitPauseMs` 60,000 | no `Retry-After` was seen, and the documentation's only stated wait is one minute |
| alternative | the v1 socket topics `index` and `markPrice` at one push a second | no REST fan-out, but they are undocumented and the engine's anchor path is REST |

The index basket holds five outside venues and no perpetual, so no deny list entry comes from this venue.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HashKey Global API, Get Exchange Information, Get Order book, Get Merge Depth, Get Symbol current Top of book, Check Server Time | https://hashkeyglobal-apidoc.readme.io/reference/exchangeinfo, https://hashkeyglobal-apidoc.readme.io/reference/get-order-book and siblings | 2026-09-23 | HashKey Global | sections 2, 5 and 7 |
| S2 | HashKey Global API, Get Futures funding rate and Get Futures history funding rate | https://hashkeyglobal-apidoc.readme.io/reference/get-futures-funding-rate and https://hashkeyglobal-apidoc.readme.io/reference/get-futures-history-funding-rate | 2026-09-23 | HashKey Global | `timestamp` required, API key header named, section 3 |
| S3 | Funding Rate Overview, updated 2025-02-19 | https://help.hashkey.com/hc/en-us/articles/14205661959708-Funding-Rate-Overview | 2026-09-23 | HashKey Global | index definition, 8 h interval, premium measured every minute, sections 3 and 4 |
| S4 | HashKey Global API, Get Index Price and Get Mark Price | https://hashkeyglobal-apidoc.readme.io/reference/get-index-price and https://hashkeyglobal-apidoc.readme.io/reference/get-mark-price | 2026-09-23 | HashKey Global | `edp` definition, call shapes, sections 3 and 4 |
| S5 | Adjustment of Mark Price Calculation Method for HashKey Perpetual Contracts, 2025-09-09 | https://help.hashkey.com/hc/en-us/articles/22220944476188-Adjustment-of-Mark-Price-Calculation-Method-for-HashKey-Perpetual-Contracts | 2026-09-23 | HashKey Global | mark formula, section 4 |
| S6 | HashKey Global API, Getting Started | https://hashkeyglobal-apidoc.readme.io/reference/preparations | 2026-09-23 | HashKey Global | limits and status codes, section 6 |
| S7 | CCXT 4.5.68 `hashkey.js` | `server/node_modules/ccxt/js/src/hashkey.js` | 2026-09-23 | CCXT | catalog mapping, throttle, section 2 and 6 |
| P1 | `rest-probe.mjs main` at 03:12 UTC, and the second pass at 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs poll` at 03:18 UTC, and the second pass at 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 3, 4 and 6 |
| P3 | `ws-probe.mjs anchor` at 03:22 UTC, and the second pass at 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | index basket and cadence, section 4 |
