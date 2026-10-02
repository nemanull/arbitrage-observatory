# WEEX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 03:06 to 03:47 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public futures REST API v3 of WEEX (CCXT id `weex`): the catalog, the anchor calls, the book snapshot, limits and clock.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs) unless a line names another source, and each mode was run at least twice.
The documentation was read from the static pages under `https://www.weex.com/api-doc/contract/` and from `https://www.weex.com/api-doc/llms-full.txt`, both of which answered this host with HTTP 200.
Times below are UTC on 2026-09-23 unless a line says otherwise.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api-contract.weex.com`, documented as the one contract REST domain, S1 |
| resolution | CNAME `d2pqsoz7kh4yo9.cloudfront.net`, four IPv4 addresses in `3.165.160.0/24` and eight IPv6 addresses |
| edge | CloudFront point of presence `SEA900-P6`, and `x-cache: Miss from cloudfront` on every call, so nothing is served from the edge cache |
| cold request | `GET /capi/v3/market/time` in 173, 175 and 358 ms over three runs |
| warm request | 100 to 110 ms in 14 of 15 samples, and 268 ms on the first warm sample of the first run |
| bulk replies, warm | `exchangeInfo` 262 to 417 ms for 686 KB, `premiumIndex` 132 to 226 ms for 228 KB, `ticker/24hr` 203 to 446 ms for 304 KB, `ticker/bookTicker` 116 to 278 ms for 115 KB |
| access | every public call answered 200 without a key, `/market/time` also answered 200 with the `User-Agent` header removed, and no geoblock or challenge page was served to this host |

## 2. Catalog

### The instruments call

`GET https://api-contract.weex.com/capi/v3/market/exchangeInfo`, weight 1, returns `assets`, `rateLimits` and `symbols`, S2.
It optionally filters on `symbol`, `contractType`, `underlyingType` and `underlyingSubType`.

| item | value on 2026-09-23 |
|---|---|
| rows | 995, in all three runs |
| fields per row | 25, and no `status` field, so a listed contract is the only state the catalog shows |
| `contractType` | `PERPETUAL` 577, `TRADIFI_PERPETUAL` 418 |
| `underlyingType` | `COIN` 577, `Stocks` 350, `Indices` 40, `Metals` 14, `Forex` 7, `Commodities` 4, `Pre-IPO` 3 |
| `marginAsset` and `quoteAsset` | `USDT` on 995 of 995 |
| margin assets | `USDT` and `SUSDT` are the only two of 1,931 `assets` with `marginAvailable` true, and `SUSDT` is the demo currency, S3 |
| funding interval | `collectCycle` 480 minutes on 497, 240 on 494, 60 on 4, see section 3 |
| `maxLeverage` | 10 to 400, with 20 on 324 contracts and 50 on 245 |
| `apiMakerFeeRate`, `apiTakerFeeRate` | documented as "may not be returned", and absent on 995 of 995 |

So the active perpetual count by settlement asset is USDT 995: 577 crypto and 418 TradFi.
CoinGecko's derivatives list counted 1,048 perpetual pairs for "WEEX (Futures)" on 2026-09-22, S7, and the gap to 995 was not explained.
`JP225USDT`, the Nikkei 225, is filed as `PERPETUAL` with `underlyingType` `COIN`, so `contractType` alone does not separate crypto from TradFi.

Only part of the catalog accepts API orders.
`GET /capi/v3/market/apiTradingSymbols`, weight 5, returned 290 names, of which 239 are catalog contracts, 174 crypto and 65 TradFi, and 51 are demo contracts ending in `SUSDT` such as `BTCSUSDT`.
756 of 995 contracts are absent from it, among them `API3USDT`, `ENJUSDT`, `WAVESUSDT` and `SUSHIUSDT`, and an API order on one of them is refused with `-1058 NO_PERMISSION_TRADE_PAIR`, S11.

### How CCXT 4.5.68 maps it

`fetchMarkets` requests the spot and the contract `exchangeInfo` together and parses both, at `server/node_modules/ccxt/js/src/weex.js` lines 929 to 941.
`loadMarkets` took 3.8 to 3.9 s from this host and produced 4,505 markets: 995 swaps and 3,510 spot.

| CCXT field | source | on 2026-09-23 |
|---|---|---|
| `id` | `symbol` | equal to the socket `s`, the REST `symbol` and the anchor `symbol` on 995 of 995 |
| `base`, `quote`, `settle` | `baseAsset`, `quoteAsset`, `marginAsset` | no base renamed by CCXT |
| `linear` | settle equals quote | true on 995 of 995 |
| `active` | set to true for every contract, line 1007, while only the spot branch reads `enableTrade`, line 1025 | true on 995 of 995 |
| `contractSize` | `contractVal`, line 1060 | equal to `contractVal` on 995 of 995, from 0.0001 to 1,000,000 |
| `taker`, `maker` | `takerFeeRate`, `makerFeeRate`, lines 1057 and 1058 | 0.0008 taker on 994, see [`fees.md`](./fees.md) section 8 |
| `precision.amount` | `quantityPrecision` | a step equal to `contractVal` on 995 of 995 |

Because `active` is hard coded, a contract whose opening has been suspended ahead of a delisting still reads as active.
A delisted contract leaves the catalog: `IKAUSDT`, delisted in June 2026, answered `-1142` on every REST call, S5.

### Size unit, pairs listed twice, and price scale

The book and the order quantity are in base coins, not in contracts.
The REST book's sizes are whole multiples of `contractVal` on every level in three runs, 400 of 400 on `BTCUSDT`, and the socket's sizes equal the REST sizes, see [`websocket.md`](./websocket.md) section 4.
A `BTCUSDT` touch of `"2.5807"` is 2.58 BTC, and read as contracts of 0.0001 BTC it would be about 22 USDT on the best bid of the largest perpetual.
CCXT sends `amount` as `quantity` unchanged, at line 2012, and the documentation gives `minOrderSize` in "base asset", S2.
So CCXT's `contractSize` is not the unit of any number the engine reads, and the registry must pin `contractSize: 1`, the existing option at [`../../../server/src/ccxt/types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/types.ts) line 22, read at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 175.

No base is listed twice by id, but one token is listed twice under two ids.
`牛来USDT` is displayed as `牛来OLDUSDT` and `NIULAIUSDT` is displayed as `牛来USDT`, and CCXT gives them the bases `牛来` and `NIULAI`.
Six contracts have a `displaySymbol` that differs from `symbol`: `TONUSDT` shows as `GRAMUSDT`, `BIANRENSHENGUSDT` as `币安人生USDT`, `LGSTOCKSUSDT` as `LGELECTRONICSUSDT`, `TGTSTOCKUSDT` as `TGTUSDT`, and the two above.
Whether `TONUSDT` is the token other venues call TON is Not verified.

Multiplied bases carry the multiplier in the name: `1000PEPE`, `1000FLOKI`, `1000SHIB`, `1000SATS`, `1000RATS`, `1000BONK`, `1000BTT`, `1000XEC` and `1MBABYDOGE`.
They cluster only with markets of the same base name, so no `PRICE_SCALE` entry is needed for them.
TradFi bases are plain stock tickers, such as `AAPL`, `META`, `MSTR`, `KO` and `JD`, and any of them that names a crypto token on another venue would need a `DENIED_PAIRS` line.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | weight | reply | warm time |
|---|---|---|---|---|---|---|---|---|
| `GET /capi/v3/market/premiumIndex` | `indexPrice` | `markPrice` | `forecastFundingRate`, upcoming, and `lastFundingRate`, settled | `collectCycle`, minutes | `nextFundingTime`, Unix ms | 1 | 228 KB, 995 rows | 60 polls, two runs: min 126, median 135 and 138, p90 393 in both, max 414 and 405 ms |
| `GET /capi/v3/market/ticker/24hr` | `indexPrice` | `markPrice` | absent | absent | absent | 40 | 304 KB, 995 rows | 20 polls, two runs: min 113 and 116, median 204 and 207, max 553 and 487 ms |
| `GET /capi/v3/market/symbolPrice?symbol=…&priceType=MARK` or `INDEX` | one symbol | one symbol | absent | absent | absent | 1 per call | 59 bytes | 108 to 174 ms |

`premiumIndex` carries every `AnchorRow` column in one call keyed by `symbol`, which is CCXT's `market.id`, but its prices are a minute old, section 4.
The ticker carries a live index and mark at 40 times the weight, and nothing about funding.
`symbolPrice` is live but covers one symbol per call, and 995 contracts at two calls each would take 1,990 weight, four times the 10 s budget.
CCXT reads `premiumIndex` for `fetchFundingRates`, at `server/node_modules/ccxt/js/src/weex.js` line 1692, and the ticker for `fetchTickers`.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` in both replies | string, `BTCUSDT` | none |
| `index` | ticker `indexPrice` | decimal string | `Number()` |
| `mark` | ticker `markPrice` | decimal string, never 0 on 995 rows | `Number()` |
| `fundingRate` | `premiumIndex` `forecastFundingRate` | decimal string, a fraction per interval: `"0.00004112"` is 0.004112 % | `Number()` |
| `fundingIntervalHours` | `premiumIndex` `collectCycle` | integer minutes: 60, 240 or 480 | divide by 60 |
| `nextFundingAt` | `premiumIndex` `nextFundingTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none, and skip a value in the past |

At 03:26, 03:41 and 03:46 UTC, 498 contracts read `nextFundingTime` 04:00 UTC and 496 read 08:00 UTC.
The 4 hourly contracts and the 494 on four hours settle at 04:00, and the 497 on eight hours at 08:00.
`DALUSDT` read `28800000`, which is 1970-01-01 08:00 UTC, and its funding history was empty, so a poller has to drop a `nextFundingTime` in the past.
`collectCycle` equals 1,440 divided by the number of `delivery` times in the catalog on 995 of 995 contracts.
By type, crypto perpetuals are 126 on 8 h, 447 on 4 h and 4 on 1 h, and TradFi perpetuals are 371 on 8 h and 47 on 4 h.

The funding rate is a fraction per interval.
`lastFundingRate` equalled the newest settled row of the funding history on `ETHUSDT` (8 h), `GASTOWNUSDT` (1 h) and `SCRUSDT` (4 h), in three runs out of three, for example `0.00009373` settled at 00:00 UTC on `ETHUSDT`.
So `forecastFundingRate` is the rate for the upcoming settlement, which is what `fundingRate` means in the engine.
CCXT maps the other way: its `fundingRate` is `lastFundingRate` and its `nextFundingRate` is `forecastFundingRate`, at `server/node_modules/ccxt/js/src/weex.js` lines 1730 and 1733.

## 4. Anchor semantics

### The minute old prices in premiumIndex

The bulk and the one symbol `premiumIndex` refresh `markPrice` and `indexPrice` once a minute, on the minute, while their `time` field advances every second.

| read over 60 to 70 s | BTC mark changes | BTC index changes |
|---|---|---|
| bulk `premiumIndex`, once a second | 1, at 03:32:00 and at 03:44:00 in two runs | 1, at the same instants |
| one symbol `premiumIndex`, once a second | 1, 0.1 to 0.2 s after the bulk read | 1 |
| `symbolPrice` `MARK` and `INDEX`, once a second | 37 and 43 in 70 s | 47 and 54 in 70 s |
| bulk ticker, every 2 s | 8 and 18 of 19 intervals | 16 and 19 of 19 |

Across the whole catalog, each contract's `premiumIndex` mark changed at most once in 59 one second intervals, in both poll runs, and 156 and 171 contracts did not change at all.
In the same polls `time` took 60 distinct values, stepped by 816 to 1,195 ms, and was 51 to 153 ms old on arrival, one value for every row of a reply.
So a reader that trusts `time` would take a minute old price as fresh.
The ticker's mark matched `premiumIndex` on only 177 and 252 of 995 contracts when both were read inside a second, and on 677 in the run whose read fell about 2 s after the minute refresh.
At 03:41 the `premiumIndex` BTC mark was `86903.5` while the ticker BTC mark read 0.2 s later was `86811.7`, 1,057 ppm apart.
A poller on `premiumIndex` alone would also see each minute's move as one jump: 407 and 574 index or mark steps above 1,000 ppm in 117,410, all at the minute, which trips the reader's `MAX_ANCHOR_MOVE_PPM` at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 6.

### Index

The index formula and basket are Not publicly specified in the API documentation or the help center pages read, and no basket endpoint exists in the v3 contract API.
The index moved on 16 and 19 of 19 two second ticker intervals for BTC, and 109 and 176 of 995 contracts had an index that did not move over 38 s of ticker polls.
On TradFi contracts the index stood still in these reads, which were taken while the US stock market was closed.
`AAPLUSDT` read index `294.645`, `METAUSDT` `603.78` and `MSTRUSDT` `191.465` both at 03:27 and at 03:45, with 0 changes in the 19 intervals of the second ticker run, while their marks traded at `340.85`, `743.79` and `170.54`.
In the second ticker run, 91 of 418 TradFi indexes and 18 of 577 crypto indexes did not move in 38 s.

### Mark

The mark formula is Not publicly specified.
The Futures Trading Terms define it as "the fair market value of the relevant Futures … as calculated pursuant to the methodology set out in the relevant Futures Trading Rules", S6, and those rules were not found.
No clamp to the index was observed.
The mark over index premium in the `premiumIndex` reply had a median of 0, a 1st percentile of -9,056 to -14,621 ppm and a 99th percentile of 14,522 to 15,506 ppm over three reads.
Its extremes were `HUNDUSDT` at +306,065 to +308,460 ppm, `ONEUSDT` at -224,834 to -240,069, `METAUSDT` at +230,100 to +231,839, `DATAIPUSDT` at +216,861 to +220,573, `AAPLUSDT` at +156,510 to +156,816 and `MSTRUSDT` at -109,550 to -114,042.

The mark often equals the last trade.
In the bulk ticker, `markPrice` equalled `lastPrice` on 251 to 263 of 577 crypto contracts and on 191 to 210 of 418 TradFi contracts in any one read, over three reads.
On the socket, the AAPL ticker's `m` equalled its last trade `c` on 75 of 75 frames and the BTC ticker's on 42 of 125.
A mark that is the last trade carries nothing the book does not, and a TradFi route pairs such a mark with a frozen index.

`mark` equalled `index` exactly on 32 to 37 crypto and 185 to 201 TradFi rows of `premiumIndex`.
`ONEUSDT` is already in `DENIED_PAIRS` at [`../../../server/src/engine/cluster/clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) line 11, and its WEEX mark sat 22 to 24 % below its index.

### Funding

The formula is `F = P + clamp(I - P, premium deviation floor, premium deviation ceiling)`, then `clamp(F, funding rate floor, funding rate ceiling)`, S8.
`I` is the quote currency interest index minus the base currency interest index, divided by the funding interval, and `premiumIndex` publishes an `interestRate` of `0.0003` on 985 of 995 contracts.
`P` is `[max(0, depth weighted bid - mark) - max(0, mark - depth weighted ask)] / spot price + fair basis of mark price`, averaged, S8.
The floors and ceilings per contract are Not publicly specified.
The largest upcoming rates were `KERNELUSDT` at 0.00601 to 0.00715 and `1000BTTUSDT` at 0.00463 to 0.00492, per interval.
`forecastFundingRate` also refreshes once a minute: it changed at most once in 59 s on every contract, and not at all on 394 and 399.
`lastFundingRate` equalled `forecastFundingRate` on 361 or 362 contracts.

### Rate across a settlement

Not captured.
The funding history shows settlements exactly on the `delivery` times, 8 h apart for `ETHUSDT`, 4 h for `SCRUSDT` and 1 h for `GASTOWNUSDT`, each row carrying the settled rate and the mark at that instant, S9.
Whether `forecastFundingRate` resets after the hour, and how long `lastFundingRate` takes to change, were not observed.

### How often each number changed

| number | source | changes |
|---|---|---|
| BTC mark | ticker, 2 s | 8 and 18 of 19 intervals |
| BTC index | ticker, 2 s | 16 and 19 of 19 |
| catalog mark | ticker, 2 s | median 3 and 4 of 19, and 96 to 157 contracts never |
| catalog index | ticker, 2 s | median 3 and 4 of 19, and 109 to 176 contracts never |
| catalog mark and index | `premiumIndex`, 1 s | at most 1 of 59 |
| `forecastFundingRate` | `premiumIndex`, 1 s | at most 1 of 59 |
| `lastFundingRate`, `nextFundingTime` | `premiumIndex`, 1 s | 0 of 59, no settlement fell in the window |

## 5. REST book snapshot

`GET /capi/v3/market/depth?symbol=BTCUSDT&limit=200`, weight 1, S2.
`limit` takes only 15, the default, or 200, and `limit=20` answers HTTP 400 `{"code":-1142,"msg":"Parameter 'limit' is invalid."}`.

| item | value |
|---|---|
| levels | 200 and 200 on BTC and ETH, and fewer on thin books, 74 to 78 bids on `DOODUSDT` |
| order | bids descending and asks ascending, in every read |
| size unit | base coins, whole multiples of `contractVal` on every level in three runs |
| `lastUpdateId` | equal to the socket's last `u` at the same moment in 5 of 5 compares in each book run, so the REST book is the socket's 500 ms book |
| caching | two back to back reads returned the same `lastUpdateId` on 9 of 12 pairs, and CloudFront reported a miss on every read, so the repeat is the 500 ms grid, not a cache |
| symbol case | `btcusdt` was accepted and answered the BTC book |

`GET /capi/v3/market/ticker/bookTicker` without a symbol, weight 1, returned 984 rows, 11 fewer than the catalog.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| IP weight | "500 weight / 10 sec / per IP", S4. The `rateLimits` array in `exchangeInfo` reads `{"rateLimitType":"REQUEST_WEIGHT","interval":"MINUTE","intervalNum":10,"limit":500}` | the headers are `x-used-weight-10s` and `x-remaining-weight-10s`, and the used count fell back to 1 after an 11 s pause, so the window is 10 s and the array's `MINUTE` is wrong |
| weights | 1 for `exchangeInfo`, `premiumIndex`, `depth`, `bookTicker`, `symbolPrice` and `time`, 5 for `fundingRate` and `apiTradingSymbols`, 40 for `ticker/24hr`, S2 | the same, from the header deltas in three runs. A one symbol ticker, read by hand with curl at about 03:31, raised the used count from 1 to 40 |
| over the limit | HTTP 429, and "Violating the limits results in a `10s` ban", S10 | not triggered. The highest use was 204 of 500 in the ticker mode |
| `Retry-After` | Not publicly specified | never seen, since no 429 occurred |
| order limit | 300 orders a minute per account, S4 | not probed |
| error shape | `{"code": -1121, "msg": "Invalid symbol."}`, S11 | HTTP 400 with `{"code":-1142,"msg":"Parameter 'symbol' is invalid."}` for an unknown or delisted symbol on `depth`, `premiumIndex` and `exchangeInfo`, and `{"code":-1141,"msg":"Parameter 'symbol' cannot be empty."}` for `fundingRate` without one |
| unknown path | | HTTP 404 `{"timestamp":…,"status":404,"error":"Not Found","path":"/capi/v3/market/nope"}` |

CCXT counts its own weights on a different scale, with `rateLimit` 20 ms and, for example, 5 for `premiumIndex` and 200 for `ticker/24hr`, at `server/node_modules/ccxt/js/src/weex.js` lines 24, 258 and 267.

## 7. Server time and clock offset

`GET /capi/v3/market/time`, weight 1, answers `{"serverTime":1790134010126}` in Unix ms.
The server clock led this host's midpoint by 1 to 6 ms in 14 of 15 samples over three runs, and by 84 ms in the one sample whose round trip took 268 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://api-contract.weex.com/capi/v3/market/ticker/24hr` for index and mark, and `https://api-contract.weex.com/capi/v3/market/premiumIndex` for the funding columns, both without `symbol` | the ticker's prices are live and `premiumIndex`'s are a minute old |
| interval | 2,000 ms, as Bybit's poller uses | 41 weight a round is 205 of the 500 per 10 s. At 1,000 ms it would be 410. BTC's mark moved about every 2 s on `symbolPrice` |
| row mapping | section 3, keyed by `symbol` | |
| reading time | stamp on arrival and never read `premiumIndex` `time` | `time` is the reply's clock, not the price's |
| do not read | `premiumIndex` `markPrice` and `indexPrice`, and CCXT's `fetchFundingRates` `fundingRate` | a minute old, and the settled rate |
| skip | `TRADIFI_PERPETUAL` rows, and `JP225USDT` | the index freezes while the mark follows the last trade, section 4 |
| skip | rows whose `nextFundingTime` is in the past | `DALUSDT` read 1970 |
| rate limit pause | `rateLimitPauseMs` 10,000 | the window is 10 s, the ban is 10 s, and no `Retry-After` was seen |
| alternative | the socket ticker, `<SYMBOL>@ticker`, pushes `m` and `i` about once a second or faster | it would take 995 more streams, which at 100 per connection doubles the socket count toward the 20 an IP may hold |

The two replies are 532 KB a round, about 23 GB a day at one round every 2 s, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WEEX Futures API, API Domain | https://www.weex.com/api-doc/contract/QuickStart/APIDomain | 2026-09-22 | WEEX, global | host, section 1 |
| S2 | WEEX Futures API, Market endpoints: Get Exchange Information, Get Current Funding Rate, Get Order Book Depth, Get Funding Rate History, Get Symbol Price, Get 24hr Ticker Statistics | https://www.weex.com/api-doc/contract/Market_API/GetContractInfo | 2026-09-22 | WEEX, global | fields, filters, weights, depth limits, sections 2 to 6 |
| S3 | WEEX Futures API, FAQs, paper trading in SUSDT | https://www.weex.com/api-doc/contract/apifaq | 2026-09-22 | WEEX, global | the demo currency, section 2 |
| S4 | WEEX Futures API, FAQs, rate limits and error -1052 | https://www.weex.com/api-doc/contract/apifaq | 2026-09-22 | WEEX, global | 500 weight per 10 s, 300 orders a minute, unsupported API pairs, sections 2 and 6 |
| S5 | IKA USDT-M perpetual futures delisting announcement | https://www.weex.com/help/articles/a6a22y1l0vwiwycx9knc58fo | 2026-09-22 | WEEX, global | the delisted contract used in section 2 |
| S6 | Futures Trading Terms of Use, last updated 30 June 2025 | https://www.weex.com/help/articles/48842594089625 | 2026-09-22 | WEEX, global | the mark price definition, section 4 |
| S7 | CoinGecko derivatives exchanges list, "WEEX (Futures)" | https://www.coingecko.com/en/exchanges/derivatives | 2026-09-22 | CoinGecko | 1,048 perpetual pairs, section 2 |
| S8 | Funding Fees | https://www.weex.com/help/articles/4410862743449 | 2026-09-22 | WEEX, global | the funding and premium index formulas, section 4 |
| S9 | WEEX Futures API, Get Funding Rate History | https://www.weex.com/api-doc/contract/Market_API/GetFundingRateHistory | 2026-09-22 | WEEX, global | settled rows, section 4 |
| S10 | WEEX Futures API, Access Restrictions | https://www.weex.com/api-doc/contract/QuickStart/AccessRestrictions | 2026-09-22 | WEEX, global | 429 and the 10 s ban, the weight headers, section 6 |
| S11 | WEEX Futures API, Error Codes | https://www.weex.com/api-doc/contract/ExampleOfErrorCode | 2026-09-22 | WEEX, global | the error payload, section 6 |
| S12 | CCXT 4.5.68 `weex.js` | `server/node_modules/ccxt/js/src/weex.js` | 2026-09-22 | CCXT | the market mapping, funding field mapping, weights, sections 2, 3 and 6 |
| P1 | `rest-probe.mjs catalog`, runs at 03:26, 03:41 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 3 and 5 to 7 |
| P2 | `rest-probe.mjs poll`, runs at 03:29 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs) | 2026-09-23 | this host | poll timing, the minute refresh, move counts, sections 3 and 4 |
| P3 | `rest-probe.mjs fresh`, runs at 03:31 and 03:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs) | 2026-09-23 | this host | which source refreshes, section 4 |
| P4 | `rest-probe.mjs ticker`, runs at 03:33 and 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/weex/rest-probe.mjs) | 2026-09-23 | this host | ticker freshness, frozen TradFi indexes, mark equal to last, sections 3 and 4 |
| P5 | `ws-probe.mjs book`, runs at 03:20 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/weex/ws-probe.mjs) | 2026-09-23 | this host | REST against socket book compares, socket ticker marks, sections 4 and 5 |
