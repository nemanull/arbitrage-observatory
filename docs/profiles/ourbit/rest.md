# Ourbit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 01:29 to 02:08 UTC), from the development host near Seattle.

This profile covers the public futures REST API of Ourbit for its one perpetual family, USDT-M.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) unless a source row says otherwise.
The futures API copies the MEXC contract API v1 path for path and field for field, so CCXT's `mexc` class can read it, see section 2.
Ourbit's current contract doc, dated 2026-07-08, documents only two private history endpoints, S2.
The public market endpoints below are documented only in the old contract API v1 doc, which Ourbit still keeps in its GitHub repository but no longer serves, S1.
That doc names the host `https://contract.ourbit.com`, which does not resolve, and every endpoint below answered on `https://futures.ourbit.com` instead.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| documented host | `contract.ourbit.com`, no DNS answer | S1, `dig` on 2026-09-22 |
| host that answers | `futures.ourbit.com`, CNAME `futures.ourbit.com.cdn.cloudflare.net`, A `104.18.0.241` and `104.18.1.241` | `rest-probe.mjs host`, two runs |
| edge | Cloudflare, `cf-ray` colo `YVR` at 01:35 UTC and `SEA` at 01:59 UTC. The Cloudflare trace read `loc=CA` | `rest-probe.mjs host`, `https://futures.ourbit.com/cdn-cgi/trace` |
| cold request | 193 and 227 ms on `/api/v1/contract/ping` | `rest-probe.mjs host` |
| warm request | 10 calls each run: min 115 and 123 ms, median 120 and 129 ms, max 223 and 311 ms | `rest-probe.mjs host` |
| spot host | `api.ourbit.com`, also Cloudflare, answering the MEXC spot v3 paths, `/api/v3/ping` returns `{}` | `curl` on 2026-09-22 |
| refusals | none. Every public call answered 200, or a documented error inside a 200, see section 6 | all probe runs |

## 2. Catalog

### The instruments call

`GET https://futures.ourbit.com/api/v1/contract/detail` returns every contract in one reply of about 1.05 MB (1,048,754 bytes by `curl` at 01:29 UTC), in 314 to 745 ms.

| field | values on 2026-09-23 01:35 to 01:56 UTC | documented meaning, S1 |
|---|---|---|
| `state` | 0 on 735 of 735 | "0:enabled, 1:delivery, 2:completed, 3: offline, 4: pause" |
| `quoteCoin`, `settleCoin` | USDT and USDT on 735 | |
| `futureType` | 1 on 735 | Not publicly specified. Every contract is perpetual |
| `apiAllowed` | true on 735 | "Whether support API" |
| `isHidden` | false on 735 | Not publicly specified |
| `takerFeeRate`, `makerFeeRate` | 0.0004 and 0.0002 on 735 | see [`fees.md`](./fees.md) section 2 |
| `indexOrigin` | a list of source names per contract | "index origin", see section 4 |
| `priceCoefficientVariation` | 0.4 on 697, 0.05 on 19, 0.2 on 15, 0.1 on 2, 0.004 on 2 | "fair price coefficient variation", see section 4 |
| `conceptPlate` | the site's trade zones, 206 contracts in a TradFi zone | Not publicly specified |

The active perpetual count is 735, all USDT-M, settled in USDT.
`/api/v1/contract/support_currencies` returned `["USDT"]`.
CoinGecko listed 770 perpetual pairs at the same hour, see [`fees.md`](./fees.md) section 3.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no Ourbit class, and neither has CCXT master, see [`fees.md`](./fees.md) section 8.
The `mexc` class reads this reply unchanged once two public hosts point at Ourbit.

```js
new ccxt.mexc({ id: 'ourbit', name: 'Ourbit', urls: { api: { spot: { public: 'https://api.ourbit.com' }, contract: { public: 'https://futures.ourbit.com/api/v1/contract' } } } })
```

`loadMarkets` then returned 1,597 markets: 862 spot from `https://api.ourbit.com/api/v3/exchangeInfo` and 735 active swaps from `/api/v1/contract/detail`, `rest-probe.mjs catalog` tag `ccxtMexcLoadMarkets`.
It needs the spot host too, because `fetchMarkets` always loads spot and swap together, at `server/node_modules/ccxt/js/src/mexc.js` lines 1244 to 1247.

| CCXT field | source | on Ourbit | evidence |
|---|---|---|---|
| `market.id` | `symbol` | `BTC_USDT`, and equal to the socket's `symbol` and to the `symbol` of `/ticker` and `/funding_rate` on 735 of 735 | `mexc.js` line 1437, tags `idsMatch` and `ccxtMexcOnOurbit` |
| `active` | `state === '0'` | true on 735 | `mexc.js` line 1461 |
| `linear` | `quote === settle` | true on 735 | `mexc.js` lines 1445 and 1463 |
| `contractSize` | `contractSize` | `BTC_USDT` 0.0001, `ETH_USDT` 0.01, `HEI_USDT` 1 | `mexc.js` line 1467 |
| `taker` | `takerFeeRate` | 0.0004 on 735 | `mexc.js` line 1465 |

The connector keys a venue by the exchange id, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 91, so the `id` override is required.
Without it the venue would register as `mexc`.

### Size unit, pairs listed twice, and price scale

`contractSize` on 735 contracts: 1 on 257, 10 on 168, 0.01 on 116, 0.1 on 92, 0.001 on 42, 100 on 35, 1,000 on 11, 0.0001 on 5, 10,000 on 3, 100,000 on 2, 10,000,000 on 2, 500 on 1 and 0.00001 on 1.
Book sizes on the socket and on REST are contracts, see [`websocket.md`](./websocket.md) section 4.
The ratio of 24 h turnover to 24 h contracts times `contractSize` times last price fell between 0.80 and 1.21 on every contract, with a median of 0.99, in every run, tag `sizeUnit`.
So `contractSize` is the coin amount of one contract, and the engine's size multiplier is right.

No base and quote pair is listed twice, tag `pairsListedTwice`.
Eight contracts quote a multiple of the token: `1000PEPE_USDT`, `1000BONK_USDT`, `1000FLOKI_USDT`, `1000LUNC_USDT`, `1000XEC_USDT`, `1000RATS_USDT`, `1000000BABYDOGE_USDT` and `1000000MOG_USDT`.
Each needs a price scale in [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) wherever another venue lists the plain token.
The pairs already on `DENIED_PAIRS` exist here too: `BB_USDT`, `ON_USDT` and `QNT_USDT`, and `ONE_USDT` is not listed.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time over 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/contract/ticker` | `indexPrice` | `fairPrice` | `fundingRate` | absent | absent | 387 KB, 735 rows | runs 2 and 3: median 112 and 93 ms, p90 271 and 270 ms, max 801 and 350 ms, 0 over 1 s |
| `GET /api/v1/contract/funding_rate` | absent | absent | `fundingRate` | `collectCycle`, hours | `nextSettleTime`, Unix ms | 120 KB, 735 rows | median 122 and 123 ms, p90 136 and 131 ms, max 314 and 348 ms |
| `GET /api/v1/contract/index_price/{symbol}` | `indexPrice` | | | | | 101 bytes, one contract | per contract only |
| `GET /api/v1/contract/fair_price/{symbol}` | | `fairPrice` | | | | 100 bytes, one contract | per contract only |

Two calls per round carry every `AnchorRow` column for all 735 contracts, and both are keyed by `symbol`, which is CCXT's `market.id`.
Run 1 gave the same shape: ticker median 98 ms and max 830 ms, funding median 125 ms and max 161 ms.
`/funding_rate` also carries `maxFundingRate` and `minFundingRate`, the per contract cap and floor.
The two replies agreed on `fundingRate` on 55 to 60 of 60 polls per watched contract, and each miss fell in a run where that contract's rate changed.

### The ticker is a two second snapshot

The bulk ticker is not live.

| measure | run 1 | run 2 | run 3 |
|---|---|---|---|
| distinct snapshots in 60 one second polls | not measured | 32 | 31 |
| time between snapshots | not measured | median 1,995 ms, min 483, max 3,287 | median 2,089 ms, min 623, max 3,227 |
| arrival minus the newest row `timestamp` | median 1,256 ms, max 3,233 | median 1,221 ms, max 2,894 | median 1,317 ms, max 2,672 |

The per contract calls are fresh.
Over the same polls, `/index_price/BTC_USDT` and `/fair_price/BTC_USDT` carried a `timestamp` a median 153 and 135 ms old in run 2 and 79 and 66 ms in run 3.
They changed on 34 and 37 of 59 polls in run 2, where the bulk ticker's `BTC_USDT` index and fair price changed on 16 and 14.
So a bulk reading stamped on arrival is up to about 3.2 s older than its stamp.
The reader refuses a reading older than 10 s and two legs read more than 5 s apart, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 4 and 5, so the lag stays inside both limits, but it can hide up to 3.2 s of real skew inside the 5 s skew limit.

### Row mapping

| `AnchorRow` column | call and field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC_USDT` | none |
| `index` | `/ticker` `indexPrice` | JSON number | none |
| `mark` | `/ticker` `fairPrice` | JSON number, never 0 on 735 rows in three snapshots | none |
| `fundingRate` | `/funding_rate` `fundingRate` | JSON number, a fraction per interval: `0.000039` is 0.0039 % | none |
| `fundingIntervalHours` | `/funding_rate` `collectCycle` | integer hours: 1, 4, 8 or 24 | none |
| `nextFundingAt` | `/funding_rate` `nextSettleTime` | Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

`collectCycle` read 4 h on 452 contracts, 8 h on 280, 1 h on 2 and 24 h on 1 in every run, tag `fundingSnapshot`.
`nextSettleTime` read 02:00, 04:00, 08:00 and 16:00 UTC on 2026-09-23 for those four groups.
The ticker's `fundingRate` is the same number as `/funding_rate`, so one of the two calls can stay slower if bandwidth matters.

## 4. Anchor semantics

### Index

The index formula and weights are Not publicly specified.
Each contract's `indexOrigin` names its sources without weights.

| source name | contracts |
|---|---:|
| `GATEIO` | 431 |
| `MEXC` | 396 |
| `BITGET` | 369 |
| `BINANCE` | 352 |
| `BYBIT` | 300 |
| `BINANCECIP` | 261 |
| `KUCOIN` | 249 |
| `OKX` | 244 |
| `BINANCECIP_INDEX` | 170 |
| `BITGETCIP` | 149 |
| `REAL-TIME US STOCK QUOTE2` | 142 |
| `GATEIOCIP` | 123 |
| `BYBITCIP` | 119 |
| `OKEXCIP` | 100 |
| `OURBIT` | 71 |
| `BINGX` | 64 |
| `HYPERLIQUID` | 37 |
| `HUOBI` | 24 |
| `LIGHTER` | 6 |
| `WEEX` | 5 |
| `KRAKEN` | 4 |

Basket sizes: 1 source on 3 contracts, 2 on 20, 3 on 48, 4 on 185, 5 on 265, 6 on 149, 7 on 55, 8 on 6, 9 on 3 and 10 on 1, tag `basketSize`.
What the `CIP` suffix means is Not publicly specified.
It may name another venue's own index or perpetual, which would be the self-reference shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and that is an open question.
`REAL-TIME US STOCK QUOTE2` also sits in the baskets of crypto tokens such as `PIPPIN_USDT` and `FOLKS_USDT`, tag `tradfi`, so it is not only a stock feed.

Ourbit lists itself, `OURBIT`, in 71 baskets, tag `ownInBasket`.

| basket | contracts |
|---|---|
| `GATEIO` and `OURBIT` only | `DRV_USDT` |
| three sources, one of them `OURBIT` | `STONK_USDT`, `ZCAT_USDT`, `ZZZ_USDT`, `C_USDT`, `DEBIT_USDT`, `BGB_USDT`, `GT_USDT` |
| one source | `APM_USDT` and `CVXSTOCK_USDT` on `REAL-TIME US STOCK QUOTE2`, `VOLX_USDT` on `GATEIOCIP` |

Whether `OURBIT` means Ourbit spot or Ourbit's own perpetual is Not publicly specified.
No basket call returns weights or constituent prices.

### Mark

Ourbit calls the mark the fair price, and its formula is Not publicly specified.
The help center says only that "Fair price reflects the most reasonable price in the market", S3, and that a US stock perpetual's fair price is "based on the latest trade price of the underlying US stock", S4.

| measure | run 1 | run 2 | run 3 |
|---|---:|---:|---:|
| fair price equal to the perpetual's last trade | 300 of 735 | 218 | 221 |
| fair price between last trade and index | | | 713 |
| fair price inside the best bid and ask | | | 374 |
| distance from the index, median | 495 ppm | 413 ppm | 472 ppm |
| distance from the index, p90 | 2,044 ppm | 2,026 ppm | 2,266 ppm |
| distance from the index, max | 27,940 ppm, `CATE_USDT` | 29,282 ppm, `CATE_USDT` | 30,496 ppm, `CATE_USDT` |

The fair price follows the perpetual's own trades and carries its full dislocation from the index, 3 % on `CATE_USDT` with the fair price equal to the last trade.
So a cross between Ourbit and another venue shows in Ourbit's premium, and the fresh gate can see it.

`priceCoefficientVariation` is documented only as "fair price coefficient variation", S1.
Read as a band around the index, it was 0.004 on `BTC_USDT` and `ETH_USDT`, 0.4 on 697 contracts, and 0.05 to 0.2 on the rest, tag `fairBand`.
The fair price sat inside that band on 735 of 735 contracts, and no last trade was outside it, so no reading showed a clamp at work.
If it is a clamp, a `BTC_USDT` or `ETH_USDT` leg dislocated by more than 0.4 % would read a capped premium, the shape that reads a capped leg as fresh.
That is an inference, and it is an open question.

### Funding

The rate formula is Not publicly specified, S3.
Each contract carries a symmetric cap and floor, `maxFundingRate` and `minFundingRate`, see [`fees.md`](./fees.md) section 6, and no contract sat at its cap in three snapshots.
The published rate is a live estimate for the coming settlement.
`LSK_USDT` read -0.000563, -0.000725 and -0.000765 at 01:36, 01:53 and 01:59 UTC for the settlement at 02:00 UTC.
Rates change in batches: over 59 poll pairs a median of 0 contracts changed rate, and single polls changed 127, 193 and 193 contracts at once in the three runs.

### Rate across a settlement

`GET /api/v1/contract/funding_rate/history?symbol=BTC_USDT&page_num=1&page_size=6` returns `settleTime`, `fundingRate` and `collectCycle` per settlement, newest first, with 2,754 settlements on `BTC_USDT`.
`BTC_USDT` settled 0.000009 at 00:00 UTC, while the published rate for 08:00 UTC read 0.000033 to 0.000039 during the probes.
The settlement instant itself was not captured, because no probe waited for one.
So whether the settled rate equals the last published estimate is Not verified.
`page_size` above the documented maximum of 100 falls back to 20, tag `error`.

### How often each number changed

Changes over 59 consecutive one second polls of the bulk ticker, runs 1, 2 and 3.

| contract | index | fair price | funding rate |
|---|---|---|---|
| `BTC_USDT` | 17, 16, 13 | 18, 14, 16 | 0, 0, 0 |
| `ETH_USDT` | 19, 15, 17 | 18, 16, 15 | 0, 1, 0 |
| `LSK_USDT` | 17, 19, 16 | 16, 18, 17 | 0, 1, 1 |
| `AMD_USDT` | 12, 11, 12 | 13, 14, 12 | 0, 0, 0 |
| `HEI_USDT` | 7, 4, 4 | 5, 4, 9 | 0, 1, 1 |

Across all contracts, a median of 44, 72 and 23 indices and 46, 71 and 26 fair prices changed per poll, and at most 214 and 276.
The ceiling on this table is the two second ticker refresh, not the venue's own cadence.
The `AMD_USDT` index kept moving outside NYSE hours.

## 5. REST book snapshot

`GET /api/v1/contract/depth/{symbol}?limit={n}`, S1.

| request | levels | reply | order |
|---|---|---|---|
| no `limit` | 344 bids and 239 asks, then 342 and 239 on `BTC_USDT` | 8.7 KB, 215 to 396 ms | bids descending, asks ascending |
| `limit=5`, `20`, `100` | exactly 5, 20, 100 per side | 277 bytes to 3.6 KB, 127 to 154 ms | the same |
| `limit=1000` | the whole book, as with no `limit` | 8.7 KB | the same |
| `limit=abc` | `{"success":false,"code":600,"message":"Param error!"}` | HTTP 200 | |

A level is `[price, contracts, orderCount]`, and the reply carries `version` and `timestamp`.
`version` is the same per contract counter as the socket's, which is what lets a feed align a REST seed with the delta stream, see [`websocket.md`](./websocket.md) section 4.
Two calls back to back returned versions 134 and 10 apart, and `cf-cache-status` read `DYNAMIC`, so the reply is not cached at the edge.
The `timestamp` was 206 to 375 ms old on arrival.
`GET /api/v1/contract/depth_commits/{symbol}/{n}` returns the last `n` single level changes, newest first, with versions stepping down by exactly 1, which is the gap filler the old doc's recipe uses.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public market endpoints | "Rate limit: 20 times /2 seconds" on each, S1 | no refusal at 4 requests per second across four endpoints for 60 s. The limit was not tested |
| `/detail` | "Rate limit: 1 times / 5 seconds", S1 | the probe keeps two reads 5.5 s apart |
| limit refusal | code 510 "Excessive frequency of requests", S1 | not seen. The HTTP status of a refusal is Not verified |
| rate limit headers | Not publicly specified | none on any reply, tag `headers` |
| `Retry-After` | Not publicly specified | not seen |
| unknown contract | code 1001 "Contract does not exist" | HTTP 200 `{"success":false,"code":1001,"message":"Contract does not exist!"}` on depth, funding rate, index price, fair price and ticker |
| bad parameter | code 600 "Parameter error" | HTTP 200 `{"success":false,"code":600,"message":"Param error!"}` |
| unknown path | | HTTP 404 with an HTML page |

Errors arrive as HTTP 200 with `success` false.
The anchor poller pauses only on HTTP 403, 418 and 429, at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) and [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts), so an Ourbit poller has to treat `success` false as a failed round.
Seeding 735 contracts from the depth call at 20 requests per 2 s takes about 74 s, which matters only for a delta book feed.

## 7. Server time and clock offset

`GET /api/v1/contract/ping` returns `{"success":true,"code":0,"data":1790126705933}`, the server time in ms.
Server time minus the local midpoint of each call: median 4 and 3 ms over 10 calls in two runs, with outliers of 57 and 96 ms that match slow round trips.
The clock agrees with this host within the round trip noise.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://futures.ourbit.com/api/v1/contract/ticker` and `https://futures.ourbit.com/api/v1/contract/funding_rate`, fetched together each round | the ticker carries index and fair price for all 735, and the funding call carries the interval and next settlement |
| interval | 1,000 ms, the default | 2 of the 20 requests per 2 s on each endpoint. The ticker only changes every 2 s, so a faster poll adds nothing |
| row mapping | section 3, key `symbol` | |
| failed round | throw when `success` is not true | errors and, presumably, rate limit refusals arrive as HTTP 200 |
| rate limit pause | `rateLimitPauseMs` 2,000 | the documented window is 2 s. No `Retry-After` exists to read |
| skip | contracts whose catalog `state` is not 0 | documented states 1 to 4. The ticker carries no state |
| do not use | the per contract index and fair price calls | fresher, but 735 calls a second on each is about 74 times the documented 10 per second |
| deny list input | `DRV_USDT`, whose basket is half `OURBIT`, and the seven three source baskets with `OURBIT` in section 4 | the self-index shape |
| deny list input | `APM_USDT`, `CVXSTOCK_USDT` and `VOLX_USDT` | a single source basket |
| watch | `BTC_USDT` and `ETH_USDT` premiums near 0.4 % | a possible fair price clamp, section 4 |

The bulk readings arrive 0.2 to 3.2 s after their own timestamps, so Ourbit legs are always older than their stamp by up to a ticker refresh.
That is the one anchor property to flag for the engine.
The ticker reply is about 33 GB a day at one hertz and the funding reply about 10 GB.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Ourbit contract API v1 documentation, English, 2021 to 2024, kept in the `gh-pages` branch but no longer served at `https://ourbitdevelop.github.io/apidocs/contract_v1_en/` (HTTP 404) | https://raw.githubusercontent.com/ourbitdevelop/apidocs/gh-pages/contract_v1_en/index.html | 2026-09-22 | Ourbit, global | host, endpoints, field meanings, rate limits, error codes, depth recipe, sections 1 to 6 |
| S2 | Ourbit contract API documentation, 2026-07-08 | https://ourbitdevelop.github.io/apishortdocs/contract_en/ | 2026-09-22 | Ourbit, global | the current doc's scope: order and deal history only |
| S3 | Common Q&As and Funding Rate Mechanism | https://www.ourbit.com/support/articles/360044646991 and https://www.ourbit.com/support/articles/13322295212313 | 2026-09-22 | Ourbit, global | fair price wording, funding rules, section 4 |
| S4 | Ourbit US Stock Futures Trading Guide, 2025-09-03 | https://www.ourbit.com/support/articles/17827791511905 | 2026-09-22 | Ourbit, global | stock fair price, section 4 |
| S5 | CCXT 4.5.68 `mexc.js` | `server/node_modules/ccxt/js/src/mexc.js` | 2026-09-22 | CCXT | market mapping, section 2 |
| P1 | `rest-probe.mjs host`, 01:35 and 01:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) | 2026-09-22 | this host | section 1 and 7 |
| P2 | `rest-probe.mjs catalog`, eight runs 01:35 to 02:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) | 2026-09-22 | this host | section 2 and 4 |
| P3 | `rest-probe.mjs anchor`, runs at 01:36, 01:50 and 01:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs book`, `history` and `errors`, 01:35 to 01:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ourbit/rest-probe.mjs) | 2026-09-22 | this host | sections 4 to 6 |
