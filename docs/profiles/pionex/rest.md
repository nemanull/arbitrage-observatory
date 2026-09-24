# Pionex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:05 to 03:50 UTC), from the development host near Seattle.

This profile covers the public REST API of Pionex for its perpetuals: the catalog, the bulk anchor call, the funding history, the book snapshot, limits and errors.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) or by a curl command quoted beside it, unless it cites a documentation source from section 9.
Where the documentation and the wire disagree, both are written.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.pionex.com`, S1 |
| resolution | `api.pionex.com` is a CNAME of `cf-cdn.pionex.com` and then `www.pionex.com.cdn.cloudflare.net`, which resolved to `104.18.2.190` and `104.18.3.190` |
| edge | Cloudflare, `cf-ray` suffixes `YVR` and `SEA` |
| cold request, curl, `GET /api/v1/market/indexes` | three runs: DNS 7 to 39 ms, TCP 13 to 45 ms, TLS done at 27 to 60 ms, first byte at 75 to 95 ms, total 76 to 101 ms for 14.1 KB of gzip |
| warm request, Node `fetch` with keep-alive, the same call | two runs of 60 polls: min 35 and 48, median 48 and 56, p90 52 and 69, max 118 and 158 ms, for 99.8 KB decoded, P2 |
| compression | `content-encoding: gzip` when asked, 14.1 KB against 99.8 KB decoded |
| access | every public call answered 200 or an error body, with no geoblock and no challenge. The Cloudflare challenge covers `www.pionex.com` pages only, see [`fees.md`](./fees.md) section 1 |

## 2. Catalog

### The instruments call

`GET /api/v1/common/symbols?type=PERP` returned 606 rows in 250,850 bytes in 161 to 200 ms over three runs, P1.
The type defaults to `SPOT`, S2, and a curl without `type` at 03:06 UTC returned the 410 spot symbols.
`type=FUTURES` and `type=SWAP` answered `{"result":false,"code":"MARKET_PARAMETER_ERROR","message":"type error",…}`.
The `status` filter takes `ALL`, `TRADING` or `OFFLINE`, S2.
`status=TRADING` returned all 606, and `status=OFFLINE` returned `"symbols": null`, so no perpetual was offline.
The call weighs 5, S2.

| family | symbol shape | count | quote |
|---|---|---:|---|
| USDT-M | `<BASE>_USDT_PERP` | 561 | USDT |
| coin-quoted | `<BASE>_ETH_PERP`, `_BTC_PERP`, `_SOL_PERP` | 23 | 9 ETH, 11 BTC, 3 SOL |
| USDT priced in a coin | `USDT_<COIN>_PERP` | 22 | the coin |

The `BTC_USDT_PERP` row, whole:

```json
{"symbol":"BTC_USDT_PERP","name":"BTC USDT PERPETUAL","type":"PERP","baseCurrency":"BTC","quoteCurrency":"USDT","basePrecision":4,"quotePrecision":1,"minNotional":"1","baseStep":"0.0001","quoteStep":"0.1","minSizeLimit":"0.0001","maxSizeLimit":"500","maxImpactLimit":"0.05","minSizeMarket":"0.0001","maxSizeMarket":"100","maxImpactMarket":"0.05","maxOrderNum":200,"status":"TRADING","liquidationFeeRate":"0.0115"}
```

The documented `contractType` field is absent from every row, although S2 lists it.

### How CCXT 4.5.68 maps it

CCXT has no Pionex class, see [`fees.md`](./fees.md) section 8.
The engine loads its catalog through a CCXT exchange object, calling only `loadMarkets` at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68 and keeping markets with `type` `swap`, `swap` true and `active` not false at lines 199 to 201.
So a Pionex catalog needs a stand-in object with `id`, `name` and `loadMarkets`, which is exactly the shape the connector's own test stubs at [`connector.spec.ts`](../../../server/src/ccxt/connector.spec.ts) line 8.
The mapping it would need:

| CCXT field | from | note |
|---|---|---|
| `id`, which becomes `rawMarketId` | `symbol` | identical to the socket `symbol` and to the `indexes` `symbol` on all 605 rows that have an index |
| `base` | the part of `symbol` before `_USDT_PERP`, or `baseCurrency` | 17 rows differ, see below |
| `quote`, `settle` | `quoteCurrency`, `USDT` | |
| `type`, `swap`, `linear` | `swap`, true, true for the USDT-M family | |
| `contractSize` | 1 | book sizes are base currency, see [`websocket.md`](./websocket.md) section 4 |
| `active` | `status === 'TRADING'` | |
| `taker` | 0.0005 | [`fees.md`](./fees.md) section 9 |

### Symbols whose base differs, pairs listed twice, and price scale

`baseCurrency` differs from the symbol prefix on 17 rows, P1: `0G_USDT_PERP` is `ZEROG`, `1INCH_USDT_PERP` is `INCH`, `2Z_USDT_PERP` is `TWOZ`, `4_USDT_PERP` is `FOUR`, `AIA_USDT_PERP` is `DEAGENTAI`, `DATA_USDT_PERP` is `DATASPOT`, `EDEN_USDT_PERP` is `OPENEDEN`, `LIT_USDT_PERP` is `LIGHTER`, `NEIRO_USDT_PERP` is `NEIROCTO`, `PUMP_USDT_PERP` is `PUMPFUN`, `WTI_USDT_PERP` is `CL`, `XYZX_USDT_PERP` is `XYZ`, and five symbols are Chinese names such as `币安人生_USDT_PERP`, whose bases are `CNBARS`, `CNHJM`, `CNWTMLL`, `CNNL` and `CNLX`.
A stand-in has to pick one of the two spellings for pairing, and these 17 rows are where a wrong pair or a missed pair would come from.
The catalog also mixes crypto with tokenized stocks and ETFs whose symbols end in `X`, such as `AAPLX_USDT_PERP`, and commodities such as `XAU_USDT_PERP`, so a ticker that names a different asset on another venue needs a `DENIED_PAIRS` line, see [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) line 7.
No base and quote pair is listed twice among the 606 rows, P1.
No symbol carries a `1000` prefix, and `PEPE_USDT_PERP`, `SHIB_USDT_PERP`, `BONK_USDT_PERP` and `FLOKI_USDT_PERP` are quoted per one coin, so no price scale is needed on the Pionex side.
`USD_USDT_PERP` is in the catalog but absent from `indexes`, `tickers` and `bookTickers`, P1, so it has no anchor and should be skipped.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/market/indexes` | `indexPrice` | `markPrice` | `nextFundingRate` | absent | `nextFundingTime`, Unix ms | 605 rows, 99.7 to 99.9 KB decoded, 14.1 KB gzip | two runs of 60 polls: median 48 and 56 ms, max 118 and 158 ms, P2 |
| `GET /api/v1/market/fundingRates?symbol=<id>&limit=2` | | | the last settled `fundingRate` | the gap between the two `fundingTime` values | | one symbol per call, weight 5 | P3 |
| WebSocket topic `INDEX` | `indexPrice` | `markPrice` | `nextFundingRate` | absent | `nextFundingTime` | one symbol per subscription, a frame every 339 to 352 ms | [`websocket.md`](./websocket.md) section 2 |

One call returns index, mark, rate and next settlement for every perpetual, keyed by `symbol`, which is the catalog id.
The funding interval is the one `AnchorRow` column no bulk call carries.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC_USDT_PERP` | none |
| `index` | `indexPrice` | decimal string | `Number()` |
| `mark` | `markPrice` | decimal string, never 0 on 605 rows | `Number()` |
| `fundingRate` | `nextFundingRate` | decimal string, a fraction per interval: `"0.0000352088"` is 0.00352 % | `Number()` |
| `fundingIntervalHours` | none in the bulk reply | 1, 4 or 8 | from the funding history, or from two consecutive `nextFundingTime` values across a settlement |
| `nextFundingAt` | `nextFundingTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:17 UTC, 214 contracts read `nextFundingTime` 08:00 UTC and 391 read 04:00 UTC, P2.
The 04:00 group holds both the 4 h and the 1 h contracts, which share that instant.
The funding history showed 8 h gaps on `BTC_USDT_PERP`, `ETH_USDT_PERP`, `USDT_BTC_PERP` and `BTC_ETH_PERP`, 4 h gaps on `ACE_USDT_PERP`, `ACT_USDT_PERP`, `AERO_USDT_PERP`, `KERNEL_USDT_PERP`, `COTI_USDT_PERP` and `IOST_USDT_PERP`, and 1 h gaps on `AAX_USDT_PERP`, over the last ten settlements of each, P3.
A sample of every eighth contract, 76 of 605, read an 8 h gap on 29, a 4 h gap on 44 and a 1 h gap on 3, P7.

The one symbol form `GET /api/v1/market/indexes?symbol=NOPE_USDT_PERP` answers `MARKET_PARAMETER_ERROR` `symbol error`, P5.

## 4. Anchor semantics

### Index

"It is derived from the weighted average of quotes from multiple spot exchanges, including Pionex, Binance, Bitfinex, Gate.io, OKX, Coinbase, Huobi, and MEXC, adjusted based on data usability and weighting factors.", S5.
With three or more valid prices, each price is clamped to within 3 % of their median, and the index is the volume weighted average, S5.
With two valid prices the index is their plain average, and with one it is that price, S5.
Pionex's own spot market is in the basket, and its own perpetual is not.
No basket or weight call is documented, so the constituents per contract cannot be read.
How the tokenized stock and commodity contracts are indexed is not documented.
`AAX_USDT_PERP` held index and mark at exactly `"44.68"` in every `INDEX` frame of the five socket runs between 03:21 and 03:43 UTC, which fits a stock index frozen while its market is closed.

### Mark

"Mark Price = Index Price + Moving Average of Basis", where "Basis = (Best Bid Price + Best Ask Price) / 2 – Index Price (sampled every 5 seconds, ignore data if sampling fails)" and the average spans "the previous 5 minutes", S6.
No clamp on the mark or on the basis is published.
The largest mark premiums over the index were `COTI_USDT_PERP` at -6,023 ppm and `ALCH_USDT_PERP` at +5,573 ppm at 03:18 UTC, and `COTI_USDT_PERP` at -5,845 ppm and `INX_USDT_PERP` at +5,041 ppm at 03:38 UTC, P2, so any clamp sits beyond 0.6 %.

So the mark's premium over the index is a five minute average of the Pionex perpetual's own basis.
That is the shape [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) warns about, a mark that trails the venue's own perpetual by minutes, so a fresh move of the Pionex book shows up in the mark only slowly.
The fresh gate reads the premium as mark over index, so a design that admits Pionex has to judge this before trusting a Pionex leg.

### Funding

The formula is in [`fees.md`](./fees.md) section 6: the average premium over the interval, plus the interest differential minus that premium clamped to ±0.05 %, with no cap on the result.
`nextFundingRate` is documented as "Estimated next funding rate", S3, which makes it the upcoming settlement.
The history confirms it: on `BTC_USDT_PERP` the last settled rate at 00:00 UTC was `0.0000024992`, while `nextFundingRate` for 08:00 read `0.0000352088` to `0.0000404014` between 03:15 and 03:42 UTC, P3 and the socket runs.
Rates beyond the ±0.05 % clamp are common on thin contracts: 23 and 22 contracts read at least +0.05 %, and 6 read at most -0.05 %, at 03:18 and 03:38 UTC, P2.

### How often each number changed

Over 59 intervals of one second polls in each of two runs, at 03:17 and 03:37 UTC, P2:

| field | rows changed per poll, of 605 | `BTC_USDT_PERP` | `ETH_USDT_PERP` | `USDT_BTC_PERP` | `BTC_ETH_PERP` |
|---|---|---:|---:|---:|---:|
| `indexPrice` | median 348 and 382, range 229 to 462 | 58 and 59 of 59 | 58, 59 | 56, 59 | 58, 59 |
| `markPrice` | median 329 and 336, range 189 to 423 | 37, 52 | 37, 57 | 39, 30 | 56, 59 |
| `nextFundingRate` | median 0, p90 41 and 39, max 172 and 84 | 1, 1 | 0, 0 | 1, 1 | 1, 1 |
| `nextFundingTime` | 0 | 0 | 0 | 0 | 0 |
| `updateTime` | | 59, 59 | 59, 59 | 59, 59 | 59, 59 |

`updateTime` sits on a 100 ms grid and was 295 to 1,708 ms old on arrival, median 904 and 990 ms, P2.
So the reply is republished about once a second, and the rate estimate moves in batches, not on every poll.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /api/v1/market/depth?symbol=BTC_USDT_PERP&limit=<n>`, weight 5, default 20, range 1 to 1,000, S3 |
| reply | `{"bids": [[price, size], …], "asks": […], "updateTime": <ms>}` |
| level order | bids descending and asks ascending at 20, 100 and 1,000 levels, P4 |
| time | 44 to 183 ms over two runs, 920 bytes at 20 levels and 40 KB at 1,000 |
| freshness | `updateTime` was 263 to 492 ms old on arrival, and two reads 600 ms apart carried different `updateTime` values and different top sizes in both runs, so no cache was seen |
| sizes | base currency, with trailing zeros trimmed (`"5.005"` where the socket sends `"5.0050"`) |
| best bid and ask for all perpetuals | `GET /api/v1/market/bookTickers?type=PERP`, 604 rows, 79 KB, P1. The futures docs spell it `/api/v1/market/bookTicker`, which answers 404 `{"error_msg":"404 Route Not Found"}` |

`bookTickers` left out `CARX_USDT_PERP` and `USD_USDT_PERP` in both runs, P1.
The 1,000 level reply of the second run opened its asks with `["86703.8","0"]`, a level of size zero at the top of the book, so a REST reader drops zero sizes, P4.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| budget | "All endpoints share the 10 per second limit based on IP", and every market call and the catalog call weigh 5, S1 | every request was spaced 600 ms apart, so no limit was reached |
| on excess | HTTP 429 and a 60 s ban of the IP, extended by 10 s per request during the ban, S1 | not provoked |
| `Retry-After` | not documented | not observed, since no 429 was provoked |
| headers | not documented | `x-ratelimit-tokens` read 29 after every market call and 25 after every catalog call at that spacing, and `x-ratelimit-last` carried Unix seconds with a fraction, such as `1790132779.8807` |
| error shape | `{"result": false, "code": "…", "message": "…", "timestamp": <ms>}`, S1 | HTTP 200 with `result` false and a `timestamp` in seconds, such as `{"result":false,"code":"MARKET_INVALID_SYMBOL","message":"symbol error","timestamp":1790133551}` |
| unknown route | | HTTP 404 `{"error_msg":"404 Route Not Found"}` |

The token header suggests a bucket of about 30 in which a market call costs 1 and a catalog call costs 5, which is an inference from two readings, not a documented rule.

| request | reply, all HTTP 200 unless noted |
|---|---|
| `depth?symbol=NOPE_USDT_PERP` | `MARKET_INVALID_SYMBOL` `symbol error` |
| `depth?symbol=BTC_USDT_PERP&limit=2000` | `MARKET_PARAMETER_ERROR` `limit error` |
| `indexes?symbol=NOPE_USDT_PERP`, and `indexes?symbol=BTC_USDT` (spot) | `MARKET_PARAMETER_ERROR` `symbol error` |
| `tickers?type=NOPE` | `MARKET_PARAMETER_ERROR` `type error` |
| `fundingRates?symbol=BTC_USDT`, and `fundingRates` with no symbol | `MARKET_INVALID_SYMBOL` `symbol error` |
| `common/symbols?symbols=NOPE_USDT_PERP` | `MARKET_PARAMETER_ERROR` `symbol error` |
| `bookTicker?type=PERP`, `/api/v1/nope` | HTTP 404 `{"error_msg":"404 Route Not Found"}` |

A poller must therefore check `result` in every 200 body, since a failure never changes the status code.

## 7. Server time and clock offset

No server time call is documented for the futures API, S1.
Every reply carries `timestamp` in ms on success.
Over two runs of 10 `bookTickers` calls, the reply `timestamp` minus the local midpoint of the request was 1 to 59 ms, median 7 and 5 ms, with a round trip of 34 to 170 ms, median 49 and 37 ms, P6.
So the server clock runs within about 10 ms of this host.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.pionex.com/api/v1/market/indexes`, no `symbol` | one call carries index, mark, rate and next settlement for all 605 rows |
| interval | 1,000 ms, the default | median 48 and 56 ms, max 158 ms over 120 polls, weight 5 of the 10 per second IP budget, and the reply republishes about once a second |
| row mapping | section 3, key `symbol` | |
| funding interval | read `fundingRates?symbol=<id>&limit=2` once per tracked market at boot, one call every 2 s, and keep the gap between the two `fundingTime` values | the bulk reply has no interval. The anchor poll already spends 5 of the 10 weight per second, so 560 history calls at weight 5 take about 19 minutes |
| funding interval, cheaper | infer it from `nextFundingTime` stepping at a settlement: the step is the interval | no extra calls, but unknown until the first settlement after boot |
| skip | `USD_USDT_PERP` and every non-USDT family | no anchor row, and outside the quote family |
| error check | treat `result: false` in a 200 body as a failed round | errors never change the status code, section 6 |
| rate limit pause | `rateLimitPauseMs` 60,000 | the documented ban is 60 s and no `Retry-After` was seen |
| judge before admitting | the mark is the index plus a 5 minute average of Pionex's own basis | section 4 |

The reply is 14.1 KB gzip, about 1.2 GB a day at one hertz.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Futures API, Basic Info and Rate Limits | https://www.pionex.com/docs/api-docs/futures-api/general-info/basic-info.md and https://www.pionex.com/docs/api-docs/futures-api/general-info/rate-limits.md | 2026-09-22 | Pionex, global | base URL, error shape, limits, sections 1, 6 and 7 |
| S2 | Futures API, Common | https://www.pionex.com/docs/api-docs/futures-api/common.md | 2026-09-22 | Pionex, global | catalog parameters and fields, section 2 |
| S3 | Futures API, Market | https://www.pionex.com/docs/api-docs/futures-api/market.md | 2026-09-22 | Pionex, global | `indexes`, `fundingRates`, `depth`, `bookTicker`, sections 3 to 5 |
| S4 | Futures API, Trade | https://www.pionex.com/docs/api-docs/futures-api/trade.md | 2026-09-22 | Pionex, global | `/uapi/v1/trade/` private paths, not used here |
| S5 | Index Price, updated 2025-07-25 | https://support.pionex.com/hc/en-us/articles/45030046487449-Index-Price, Wayback snapshot `20250808141144` | 2026-09-22 | Pionex, global | section 4 |
| S6 | Mark Price, updated 2025-03-27 | https://support.pionex.com/hc/en-us/articles/45035022192793-Mark-Price, Wayback snapshot `20250907120914` | 2026-09-22 | Pionex, global | section 4 |
| P1 | `rest-probe.mjs catalog` at 03:17 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | sections 2 and 5 |
| P2 | `rest-probe.mjs anchor` at 03:17 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 3 and 4 |
| P3 | `rest-probe.mjs funding` at 03:18, 03:36 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs depth` at 03:19 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | section 5 |
| P5 | `rest-probe.mjs errors` at 03:19 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 6 |
| P6 | `rest-probe.mjs time` at 03:19 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | section 7 |
| P7 | `rest-probe.mjs intervals` at 03:48 and 03:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/pionex/rest-probe.mjs) | 2026-09-23 | this host | section 3 |
