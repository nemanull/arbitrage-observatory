# Phemex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 (2026-09-23 UTC), from the development host near Seattle.

This profile covers the public REST API of Phemex (CCXT id `phemex`) that a catalog, an anchor poller and a book check would use.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/phemex/rest-probe.mjs) unless a source id says otherwise.
Where the documentation and the wire disagree, both are written.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.phemex.com`, S1 |
| resolution | `api.phemex.com` is a CNAME of `d1kz8c4wy16ccc.cloudfront.net`, which resolved to four addresses in `18.172.170.0/24`, and to eight in one `dig` |
| edge | CloudFront POP `SEA73-P3` on every reply |
| VIP host | `vapi.phemex.com`, "for whitelisted client IPs only", S1, resolved to `18.238.238.0/24` and was not called |
| cold request | `GET /public/time` 279 and 445 ms in two runs |
| warm request | `GET /public/time` 179 to 346 ms, 180 ms typical |
| access | every public call answered 200 to this host except the deliberate error cases of section 6, and no geoblock or refusal was seen |

A warm round trip of about 180 ms through a Seattle edge means the origin is far from this host.
The engine's reader refuses readings more than 5 s apart or older than 10 s, and no reply here came near that, section 3.

## 2. Catalog

### The instruments call

`GET /public/products` returns every product in one reply of 2,544,077 bytes, S1.
The USDⓈ-M perpetuals are in `data.perpProductsV2`, the COIN-M perpetuals and spot in `data.products`.

| list | type | status | rows |
|---|---|---|---:|
| `perpProductsV2` | `PerpetualV2`, USDT settled | `Listed` | 116 |
| `perpProductsV2` | `PerpetualV2`, USDT settled | `Delisted` | 765 |
| `perpProductsV2` | `PerpetualV2`, USDC settled | `Listed` | 10 |
| `products` | `Perpetual`, settled in BTC, ETH, SOL, XRP, ADA, SUI, LINK, AVAX | `Listed` | 8 |
| `products` | `Perpetual`, USD settled, the old model | `Delisted` | 151 |
| `products` | `Spot` | `Listed` | 177 |
| `products` | `Spot` | `Delisted` | 841 |
| `perpProductsPilot` | | | `null` |

Only `Listed` and `Delisted` occur.
`perpProductSubType` splits the 126 listed USDⓈ-M contracts into 55 `Normal`, 69 `TradFi` and 2 `PreMarket` (`ANTHROPICUSDT`, `OPENAIUSDT`).
The funding interval is in `fundingInterval` in seconds: 28,800 on 96 listed contracts and 14,400 on 30.

### How CCXT 4.5.68 maps it

CCXT reads `/public/products` and the legacy `/exchange/public/products` at `server/node_modules/ccxt/js/src/phemex.js` lines 901 and 1051, and parses every `perpetual`, `perpetualv2` and `perpetualpilot` row as a swap at lines 1103 to 1110.
It returns 1,050 swaps, of which these are active, P1.

| settle | `linear` | `active` count | `contractSize` | `market.taker` |
|---|---|---:|---:|---|
| USDT | true | 116 | 1 | `undefined` |
| USDC | true | 10 | 0 | `undefined` |
| BTC (`BTCUSD`) | false | 1 | 1 | 0.0075 |
| ETH, SOL, XRP, ADA, SUI, LINK, AVAX (`c…USD`) | false | 7 | 1 | `undefined` |

- `active` is `status === 'Listed'`, at line 751, so the 765 delisted USDT rows are inactive.
- `market.id` is the product `symbol`, for example `BTCUSDT`, `u1000PEPEUSDT` and `TSLAUSDT`.
  It equals the ticker `symbol` on 126 of 126 active linear contracts, P1, and the socket's `symbol`, see [`websocket.md`](./websocket.md) section 3.
- The `u` prefix marks two contracts whose `baseCurrency` is `"1000 SHIB"` and `"1000 PEPE"`, and CCXT removes the space to give base `1000SHIB` and `1000PEPE`, at line 701.
  The price is per 1000 coins, as on other venues' `1000PEPE` contracts, so no price scale is needed.
- `linear` is false only when `settleCurrency` differs from `quoteCurrency`, at lines 704 to 711 and 735.

### Size unit, pairs listed twice, and price scale

CCXT sets `contractSize` to 1 for every USDT settled swap without reading any field, at lines 722 to 724.
That is right: the book and the order quantity are in base coin, with `qtyStepSize` 0.001 on `BTCUSDT`, and socket and REST sizes agree, see [`websocket.md`](./websocket.md) section 4.
A USDC settled row has no `contractSize` field, so the default `' '` reaches `parseNumber(' ')` at line 733 and gives 0, which the engine's connector turns into 1, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 188 to 194.
A COIN-M row reads `"1 USD"`, so its size unit is US dollars.

No pair is listed twice with the same quote.
Ten bases are listed on both USDT-M and USDC-M, and the eight COIN-M bases are also on both, for example `BTCUSD`, `BTCUSDC` and `BTCUSDT`.
The quote family ranks linear USDT first, so only the USDT-M contract would be used, and the registry filter in [`fees.md`](./fees.md) section 9 makes that explicit.

TradFi contracts carry stock, index and commodity tickers such as `TSLAUSDT`, `NAS100USDT`, `XAUUSDT` and `NGUSDT`.
Three index baskets reference a differently spelled contract on another venue: `SPYXUSDT` on Binance futures `SPYUSDT`, `NGUSDT` on Binance futures `NATGASUSDT`, and `MUXUSDT` on Binance and Gate futures `MUUSDT`, P1.
So a cluster built by base name will not always meet the same underlying.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /md/v3/ticker/24hr/all` | `indexRp` | `markRp` | `fundingRateRr`, equal to `predFundingRateRr` on 127 of 127 rows | absent | absent | 41 KB, 127 rows | 60 polls: min 216, median 564, p90 737, max 837 ms, and in the rerun min 14, median 220, p90 651, max 748 ms |
| `GET /contract-biz/public/real-funding-rates?pageSize=200` | absent | absent | `fundingRate` | `fundingInterval`, seconds | `nextfundingTime`, Unix ms | 27 KB, 134 rows | 60 polls: min 171, median 187, p90 358, max 388 ms, and max 362 ms in the rerun |
| `GET /md/v2/ticker/24hr/all` | `indexPriceRp` | `markPriceRp` | `fundingRateRr` | absent | absent | 38 KB, 127 rows | 390 ms once, "v2 will be removed later", S1 |
| `GET /md/ticker/24hr/all`, COIN-M | `indexPrice`, scaled | `markPrice`, scaled | `fundingRate`, scaled | absent | absent | 2 KB, 8 rows | 237 ms once |

No single call carries all five `AnchorRow` columns, so the poller needs the ticker for index and mark and the funding call for rate, interval and next settlement.
The ticker's 127 rows are the 126 listed USDⓈ-M contracts plus `LSKUSDT`, which the catalog marks `Delisted`.
The funding call's 134 rows are the 126 listed USDⓈ-M contracts plus the 8 COIN-M contracts, and without `pageSize` it returns 20 rows.
`fundingRate` in the funding call equalled the ticker's `fundingRateRr` on 126 of 126 shared rows.
No row had a mark or an index of 0.

CloudFront caches the ticker reply.
In the rerun 30 of 60 one second polls came back `x-cache: Hit from cloudfront`, with no `Age` header, while the first run saw 1 hit in 60.
The funding call and the funding history answered `Miss` on every poll.
A hit repeats the previous reply, so on those polls the reading is up to about a second older than its arrival stamp, and the reader's 1,000 ppm move check sees the change arrive in one step two polls apart.

### Row mapping

| `AnchorRow` column | call and field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` in both calls | string, `BTCUSDT` | none |
| `index` | ticker `indexRp` | decimal string | `Number()` |
| `mark` | ticker `markRp` | decimal string | `Number()` |
| `fundingRate` | funding call `fundingRate`, the same number as the ticker's `fundingRateRr` but refreshed more often | decimal string, a fraction per interval: `"-0.00000326"` | `Number()` |
| `fundingIntervalHours` | funding call `fundingInterval` | integer seconds, 28800 or 14400 | divide by 3,600 |
| `nextFundingAt` | funding call `nextfundingTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:15 UTC the 104 rows on 8 h read 08:00 UTC and the 30 rows on 4 h read 04:00 UTC.
The funding call also carries `interestRate`, `fundingRateCap` and `fundingRateFloor`, see [`fees.md`](./fees.md) section 6.

## 4. Anchor semantics

### Index

| source | what it says |
|---|---|
| help center, updated Dec 5, 2019, S3 | BTC index from last prices on six sources, "Removing the highest and lowest prices", "average of the remaining four", "Publishing updated indices every second", at least 3 valid sources, a source stalled 15 s or more is dropped, and "If valid sources drop below 3, the index remains unchanged" |
| `GET /public/index-sources`, S1 and P1 | a weight per source exchange and symbol for 540 index entries, 142 KB, public |

The two disagree: the 2019 article describes an equal-weight trimmed mean, and the basket call publishes unequal weights.
`.BTCUSDT` is Binance `BTCUSDT` 63, OKX `BTCUSDT` 14, and Bitfinex, Coinbase and Kraken `BTCUSD` 1 each, so Binance spot carries 63 of 80.
How the weights combine with the trimming is Not publicly specified.

Survey of the baskets of the 126 listed USDⓈ-M contracts on 2026-09-23 UTC, P1.

| finding | contracts |
|---|---|
| no basket in the call | the 10 USDC-M contracts and `u1000SHIBUSDT`, whose index symbols `.BTCUSDC` and `.u1000SHIBUSDT` are absent, while `.SHIBUSDT` and `.USDCUSDT` are listed |
| one source only | 11 TradFi contracts: `SPYXUSDT`, `NGUSDT`, `HYUNDAIUSDT`, `SAMSUNGUSDT`, `SKHYNIXUSDT`, `CRWDUSDT`, `UVXYUSDT`, `KORUUSDT`, `KSTRUSDT`, `AMCUSDT` on Binance futures, and `ANTHROPICUSDT` on Gate futures |
| another venue's perpetual in the basket | Binance futures in 64 baskets, Gate futures in 42, Bitget futures in 41, Bybit futures in 15 |
| Phemex's own market in the basket | none |

A basket made of another venue's perpetual reads that venue's perp as the index, so on a route between Phemex and that venue the Phemex index is the other leg's own price.
That is the cross-venue form of the self-index shape in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and the list above is the deny list input.

### Mark

"Mark price = Median* (Price1, Price 2, Contract Price)", where "Price 1 = Price Index * (1 + Last Funding Rate * (Time until next Funding / Funding period)" and "Price 2 = Price Index + Moving Average (15-minute Basis)", the basis being the mid minus the index averaged over 15 minutes and recomputed every minute, S3.
No other clamp on the mark is published.

So the mark is the contract's own last price whenever that price sits between Price 1 and Price 2, and it is one of those two bounds otherwise.
The wire shows it.

- At 03:18:33 UTC the mark tick `.MBTCUSDT` read `86513.6`, the `BTCUSDT` last trade and best ask, while the index read `86555.32`, see [`websocket.md`](./websocket.md) section 6.
- The mark equalled the last price on 1,609 of 3,863 all-symbol ticker rows pushed over 125 s, see [`websocket.md`](./websocket.md) section 2.
- The mark equalled the last price on 2,242 of 7,620 REST ticker rows over 60 polls in the rerun, P2.
- Over 60 one second polls the `BTCUSDT` mark changed 8 and 17 times while its index changed 41 and 24 times, P2.

For the engine this means the fresh premium, the touch over the mark, measures the Phemex book against its own last trade inside the band.
A Phemex leg that moved on its own reads as carried by its mark rather than fresh, and a leg pushed past the band reads the band edge, which is the capped mark shape the design warns about.
The largest mark to index gap was `ANTHROPICUSDT` at -24,491 ppm at 03:15 UTC and -23,992 ppm at 03:35 UTC, and the median absolute gap over all rows was 289 and 236 ppm.

### Funding

The formula, cap and floor are in [`fees.md`](./fees.md) section 6.
The published rate is the running estimate for the next settlement: at 03:15 UTC `BTCUSDT` read `-0.00000326` for 08:00 UTC while the history call had settled `-0.00003988` at 00:00 UTC, P1.
`GET /api-data/public/data/funding-rate-history?symbol=.BTCUSDTFR8H` returns the settled rates with `fundingTime` and `intervalSeconds`, and the same call with `.BTCUSDTFR` returns no rows.
The settlement instant was not captured, so how the estimate turns into the settled rate is Not verified.

### How often each number changed

Over 60 polls one second apart, 59 intervals, in the first run and the rerun, P2.
The rerun's lower counts follow from the 30 cached ticker replies of section 3.

| contract | index | mark | ticker funding rate | funding call rate | ticker `timestamp` |
|---|---|---|---|---|---|
| `BTCUSDT` | 41, 24 | 8, 17 | 1, 1 | 1, 3 | 55, 31 |
| `ETHUSDT` | 39, 27 | 11, 13 | 1, 1 | 1, 3 | 56, 31 |
| `SOLUSDT` | 37, 27 | 3, 15 | 1, 1 | 1, 3 | 57, 31 |
| `BTCUSDC` | 45, 30 | 44, 15 | 1, 1 | 1, 3 | 58, 31 |
| `XAUUSDT` | 30, 24 | 23, 22 | 0, 0 | 0, 0 | 53, 29 |
| `TSLAUSDT` | 5, 2 | 4, 1 | 0, 0 | 0, 0 | 49, 25 |
| `PATHUSDT` | 0, 2 | 0, 3 | 0, 0 | 0, 0 | 48, 23 |

Across all 127 rows the index changed a median of 12 and 11 times and did not change on 15 and 17 rows, and the mark a median of 7 and 8 times and did not change on 19 and 13 rows.
The ticker's funding rate changed at most once a minute, on 11 of 127 rows in both runs, and the `.BTCUSDTFR` tick came about once a minute on the socket, see [`websocket.md`](./websocket.md) section 2.
The funding call's rate changed on 13 of 134 rows in both runs, up to 3 times a minute, so it is the fresher of the two.
`nextfundingTime` did not change within either minute.

## 5. REST book snapshot

| call | depth | order | reply | caching |
|---|---|---|---|---|
| `GET /md/v2/orderbook?symbol=BTCUSDT` | 30 a side, `depth` 30 | bids descending, asks ascending | 1.4 KB, about 200 ms | an immediate repeat returned `x-cache: Hit from cloudfront` with the same `sequence` in both runs |
| `GET /md/v2/orderbook?symbol=BTCUSDC` | 30 | same | 1.4 KB | |
| `GET /md/v2/fullbook?symbol=BTCUSDT` | full, `depth` 0 | same | 87 KB, 3,086 bids and 1,467 asks, and 3,094 and 1,457 in the rerun | |
| `GET /md/orderbook?symbol=BTCUSD`, COIN-M | 30 | same | integer prices scaled by 10^4 | |
| `GET /md/fullbook?symbol=BTCUSDT` | | | HTTP 500, `6001 invalid argument` | the v1 path serves COIN-M only |

The USDⓈ-M reply carries `result.orderbook_p.asks` and `result.orderbook_p.bids` beside `depth`, `sequence`, `symbol`, `timestamp`, `type`, `dts` and `mts`.
Its `sequence` is on the same counter as the socket, so a REST book can be placed against the stream, and it matched the socket's sizes on 39 or 40 of 40 shared prices, see [`websocket.md`](./websocket.md) section 4.
Because CloudFront can cache it, a REST book is not proof of the current state.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| IP limit | "every IP 5,000 requests in 5 minutes window. If exceeded this IP capacity, the user would be blocked in the following 5 minutes.", S2 | not reached |
| group limits | Contract 500 per minute, SpotOrder 500 per minute, Others 100 per minute, on a user basis, S2 | apply to signed calls |
| rate limit headers | `x-ratelimit-remaining-<group>`, `x-ratelimit-capacity-<group>`, `x-ratelimit-retry-after-<group>` in seconds, S2 | `x-ratelimit-remaining` and `x-ratelimit-capacity: 300` on `/public/*`, `/contract-biz/*` and `/api-data/*` replies, none on `/md/*` replies |
| counter under one second polls | | fell from 285 to 252 and from 290 to 283 over 60 funding calls one a second, so the counter refills within the minute |
| over the limit | HTTP 429 with the retry after header, S2 | not reached, no `Retry-After` header seen |
| unknown or bad symbol on `/md/*` | | HTTP 500 `{"error":{"code":6001,"message":"invalid argument"},"id":null,"result":null}` |
| unknown symbol on the funding calls | | HTTP 200 with `{"code":0,"msg":"OK","data":{"total":0,"rows":[]}}` or `{"rows":[]}` |
| unknown path | | HTTP 403 with an empty body from CloudFront |
| signed call without a key | HTTP 401 | `/api-data/futures/fee-rate` answered 401 `{"code": "401","msg": "401 Miss Api Key."}` |
| `/md/*` error | "HTTP 5XX return codes are used for Phemex internal errors", S2 | a bad argument also answers 500, so a 500 is not always transient |

## 7. Server time and clock offset

`GET /public/time` answers `{"code":0,"msg":"","data":{"serverTime":1790133160132}}`, in Unix ms.
Ten samples over two runs gave offsets of -1 to 7 ms at round trips of 170 to 195 ms, and -48 to 88 ms at round trips of 274 to 356 ms, so the clock agrees with this host within the asymmetry of a slow round trip.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| index, mark | `https://api.phemex.com/md/v3/ticker/24hr/all` every 1,000 ms | one call for all 127 rows, max 837 ms over 120 polls, the documented v3 path |
| rate, interval, next settlement | `https://api.phemex.com/contract-biz/public/real-funding-rates?pageSize=200` every 5 s, merged by `symbol` | the only bulk source of `fundingInterval` and `nextfundingTime`, its rate moved more often than the ticker's, and one call a second would spend 60 of the 300 counted per minute |
| row mapping | section 3, key `symbol` | |
| skip | rows not in the tracked markets, which drops `LSKUSDT` and the 8 COIN-M rows | the catalog marks them delisted or inverse |
| skip | `ANTHROPICUSDT` and `OPENAIUSDT` | `PreMarket`, one or two perp sources in the basket, and a mark 24,491 and 23,992 ppm under the index on `ANTHROPICUSDT` in two runs |
| deny list input | the 11 single source baskets and the baskets led by another venue's perpetual, section 4 | the index is the other leg's price |
| mark caveat | treat the Phemex mark as the contract's last price inside a band, section 4 | the fresh premium on a Phemex leg is small by construction |
| errors | treat a 500 with `6001` as a bad request, not an outage | section 6 |
| rate limit pause | `rateLimitPauseMs` 60,000 | the documented windows are one minute for groups and five for the IP, and the retry header is `x-ratelimit-retry-after-<group>`, not `Retry-After` |
| receive time | stamp on arrival, and never read the ticker `timestamp` | the row timestamp is the last change of the row, up to 58 s old on a quiet contract |
| CDN cache | log the share of ticker replies with `x-cache` `Hit`, and treat a hit as a repeat of the previous reading | half the rerun's ticker replies were cached, section 3 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Phemex API documentation, USDⓈ-M Perpetual Rest API | https://phemex-docs.github.io/ | 2026-09-22 | Phemex, global | base URLs, products, tickers, real funding rates, index sources, order book, sections 1 to 5 |
| S2 | Phemex API documentation, REST API Standards and Rate limits | https://phemex-docs.github.io/#rate-limits | 2026-09-22 | Phemex, global | HTTP codes, IP and group limits, rate limit headers, section 6 |
| S3 | Introduction to Mark Price & Index Price, updated Dec 5, 2019 | https://phemex.com/help-center/Introduction-to-Mark-price-Index-Price | 2026-09-22 | Phemex, global | index and mark formulas, section 4 |
| S4 | CCXT 4.5.68 `phemex.js` | `server/node_modules/ccxt/js/src/phemex.js` | 2026-09-22 | CCXT | catalog mapping, contract size, active flag, section 2 |
| P1 | `rest-probe.mjs main` at 03:14 and 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/phemex/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs poll` at 03:15 and 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/phemex/rest-probe.mjs) | 2026-09-23 UTC | this host | reply times, change counts, rate counter, sections 3, 4 and 6 |
