# Backpack REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in the local evening, which is 2026-09-23 from 03:20 UTC, from the development host near Seattle.

This profile covers the public REST API of Backpack Exchange (CCXT id `backpack`) for its one perpetual family, USDC-settled linear perpetuals.
Every protocol claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written.
All times are UTC.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| REST host | `https://api.backpack.exchange`, the only server in the API specification | S1 |
| resolved addresses | four CloudFront addresses, `99.86.101.13`, `.78`, `.87` and `.128`, reverse name `server-99-86-101-78.sea90.r.cloudfront.net`, and every reply carried `x-amz-cf-pop: SEA900-P13` | Probed, tag `dns`, and `dig -x` |
| WebSocket host | `ws.backpack.exchange`, six AWS addresses whose reverse names are `ec2-…ap-northeast-1.compute.amazonaws.com`, which is Tokyo | Probed, tag `dns`, and `dig -x` |
| `GET /api/v1/time`, cold | 154 and 471 ms in two runs | Probed, tag `time_cold` |
| `GET /api/v1/time`, warm | 107 to 170 ms on nine of ten requests, and 375 ms on one | Probed, tag `time_warm` |
| `GET /api/v1/markPrices`, served from the CDN cache | min 15 to 17, median 18 to 19, p90 23 to 26, max 194 to 231 ms over three runs of 60 polls | Probed, tag `poll_timing` |
| `GET /api/v1/markPrices` with a unique query parameter, which misses the cache | min 131, median 133 and 136, max 158 and 168 ms over two runs of 15 polls | Probed, tag `poll_cache_busted` |
| route from this host | the host's default route is a WireGuard tunnel, interface `surfshark_wg`, set up before this research and not for it. CloudFront served every request from `SEA900-P13`, so the tunnel exits in the Seattle area, inside the United States | `ip route get 99.86.101.13` |
| `GET /api/v1/status` | `{"message":null,"status":"Ok"}` | Probed, tag `status` |

A request that reaches the origin takes about 110 to 170 ms from this host, and a request the CDN answers takes about 20 ms.
One request of the second pass failed when the CDN closed a reused connection, `UND_ERR_SOCKET` "other side closed", and the probe now retries once.
Every public call answered HTTP 200 or a documented error, with no geoblock, challenge or refusal, although this host sits in a country whose persons may not trade the perpetuals, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /api/v1/markets` returns every market, and `?marketType=PERP` narrows it to perpetuals, S1.
The reply was 177,533 bytes and came from the CDN with `cache-control: public, s-maxage=300, stale-while-revalidate=600` and `age: 414` and `age: 252` in two runs, so the catalog can be up to about 15 minutes old.

| field | meaning | probed on 2026-09-23 03:23 |
|---|---|---|
| `symbol` | market id, `BTC_USDC_PERP` | every perpetual ends in `_PERP`, 103 of 103 |
| `marketType` | `SPOT`, `PERP`, `IPERP`, `DATED`, `PREDICTION`, `RFQ` in the enum | `PERP` 103, `IPERP`, `DATED` and `RFQ` 0 |
| `orderBookState` | `Open`, `Closed`, `CancelOnly`, `LimitOnly`, `PostOnly` in the enum | `Open` 91, `Closed` 11, `PostOnly` 1 |
| `visible` | shown in the app | false on `FRAG_USDC_PERP`, `ORDER_USDC_PERP` and `MSFT.US_USDC_PERP` |
| `rwaMarketType` | `STOCK`, `INDEX`, `COMMODITY`, `FX`, absent for crypto | `STOCK` 15, `INDEX` 3 |
| `quoteSymbol` | quote and settlement asset | `USDC` on 103 of 103 |
| `fundingInterval` | milliseconds | 3600000 on 103 of 103 |
| `fundingRateUpperBound`, `fundingRateLowerBound` | cap and floor "In basis points" | 150 and -150 on 100, 100 and -100 on 3 |
| `filters.price.maxPriceUpdateMultiplier`, `minPriceUpdateMultiplier` | cap on each mark and index update, section 4 | 1.0025 on `BTC`, `ETH` and `SOL`, 1.0075 on `EDGE` and `BILL`, null on `TRX` and the closed markets, 1.005 on the rest |
| `filters.quantity.stepSize` | size increment in base units | `0.00001` on `BTC_USDC_PERP` |

Active perpetuals by settlement asset: 91 USDC, of which 74 are crypto and 17 are equities or equity indices, tags `markets_by_kind` and `perp_rwa`.

### How CCXT 4.5.68 maps it

| item | CCXT | probed |
|---|---|---|
| `market.id` | `symbol`, at `server/node_modules/ccxt/js/src/backpack.js` line 704 | `BTC_USDC_PERP`, equal to the socket's `s`, the stream name suffix and the `markPrices` `symbol` on 91 of 91, tags `ccxt_id_vs_markets_symbol` and `markprices_vs_catalog` |
| `symbol` | `BASE/USDC:USDC`, line 735 | `BTC/USDC:USDC` |
| `type`, `swap`, `linear` | `PERP` maps to `swap`, `linear` true, lines 729 to 737 and 791 to 802 | 91 active swaps, all linear |
| `active` | `orderBookState === 'Open'`, line 754 | 91 active of 103 swaps |
| `contractSize` | the literal 1, line 736 | 1 on every swap |
| `taker`, `maker` | `undefined`, lines 758 and 759 | undefined on 91 of 91, see [`fees.md`](./fees.md) section 8 |
| funding interval | the literal `'interval': '1h'` in `parseFundingRate`, line 1069 | matches the wire today |

### Size unit, pairs listed twice, and price scale

Sizes on the book are in base units, and `contractSize` 1 is right.
The REST and socket books of `BTC_USDC_PERP` read `1.84699` at the best bid, which is bitcoin, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice among the active swaps, tag `ccxt_pairs_listed_twice`.

Three markets are priced per thousand tokens: `kPEPE_USDC_PERP`, `kBONK_USDC_PERP` and `kSHIB_USDC_PERP`.
Their index read 0.00493, 0.00370 and 0.00618 USDC on 2026-09-23, and `kPEPE` trades in steps of 100.
CCXT uppercases the base to `KPEPE`, `KBONK` and `KSHIB`, tag `ccxt_odd_bases`, so they cluster with nothing and do no harm.
Clustering them with `1000PEPE` style markets on other venues would need a base rename, since the price is already per thousand.

The 17 equity perpetuals have bases such as `AAPL.US` and `SPY.US`.
Their index is a Pyth price in the US session and, outside it, "defaults to the perp index" or an EWMA of the market's own order book mid, S3.
The second form is an index built from the venue's own perp, which is the shape that produced false rows before, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
At 03:34 and 03:46 UTC, which is the US overnight session, 10 and 7 equity perpetuals held at most 3 distinct index values in 60 polls, tag `poll_flat_symbols`.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/markPrices` | `indexPrice` | `markPrice` | `fundingRate` | absent | `nextFundingTimestamp`, Unix ms | 13.8 KB, 92 rows | median 18 to 19 ms from the CDN, 133 to 136 ms from the origin |
| `GET /api/v1/markets?marketType=PERP` | | | | `fundingInterval`, ms | | 103 rows | from the CDN, cached 300 s |

The `markPrices` reply carries the 91 open perpetuals and `MSFT.US_USDC_PERP`, which is `PostOnly`, tag `markprices_vs_catalog`.
Every row has exactly the five keys `fundingRate`, `indexPrice`, `markPrice`, `nextFundingTimestamp` and `symbol`, tag `markprices_fields`.
No row carries a timestamp.
The reply goes through CloudFront with `cache-control: public, s-maxage=1, stale-while-revalidate=3, stale-if-error=3600`.
In 180 polls over three runs, 174 replies carried `age: 1`, two `age: 0`, one `age: 2` and three no `age` header, and every one was a cache hit.
So a cached reply is about one second old on arrival, and it can be up to four seconds old under the stale window.
While the origin fails, `stale-if-error=3600` lets the CDN serve a reply up to an hour old, and the `age` header is then the only sign of it.
The query string is part of the cache key, so `?_=<nonce>` reaches the origin, 30 of 30 misses in 131 to 168 ms.

`GET /api/v1/markPrices?symbol=BTC_USDC_PERP` answered one row from the cache, tag `markprices_one_symbol`, and `?marketType=` takes the market type enum, S1.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC_USDC_PERP` | none |
| `index` | `indexPrice` | decimal string, `"86677.44094442"` | `Number()` |
| `mark` | `markPrice` | decimal string, rounded to the tick, `"86646"`, never 0 on 92 rows | `Number()` |
| `fundingRate` | `fundingRate` | decimal string, a fraction per 1 h interval, up to 28 significant digits: `"0.0002438565367033305404731178"` | `Number()` |
| `fundingIntervalHours` | `fundingInterval` from the markets call | integer ms, 3600000 | divide by 3,600,000 |
| `nextFundingAt` | `nextFundingTimestamp` | integer Unix ms, `1790136000000` is 2026-09-23 04:00 | none |

At 03:23 all 92 rows read `1790136000000`, the next whole hour, tag `markprices_next_funding`.

## 4. Anchor semantics

### Index

"For Index Price, we retrieve market price data from a set of exchanges.", S2.
For each exchange the price is the median of best bid, best ask and last trade, prices more than 100 bps from the median of the exchanges are pulled to that bound, and the index is a weighted mean, S2.
The exchanges and their weights are Not publicly specified, and no public basket call exists in the API specification or the web app's calls, S1.
Whether Backpack's own book is in a crypto basket is therefore unknown.
The equity perpetuals use a different index, section 2.

### Mark

The mark is, in order of preference, S2:

1. "Index price + 1 minute EWMA of (mid price - index price) delta."
2. Index price.
3. The median of best bid, best offer and last trade on Backpack.
4. The mid on Backpack.
5. The last trade on Backpack.

"Markets in post only state will use the index price as the mark price", S2.

Three clamps apply.

| clamp | rule | value | evidence |
|---|---|---|---|
| mark bound | "If the mark price deviates from the index price beyond a percentage threshold, Backpack will bound the mark price by that threshold", with 5 % as the example and "may be relaxed for certain new listings" | the threshold per market is Not publicly specified | S2 |
| update cap | "an update is capped at `prev * max_price_update_multiplier`", for mark and index | 0.25 % per update on BTC, ETH and SOL, 0.5 % on 85 open perpetuals, 0.75 % on 2, none on `TRX` | S1, Probed, tag `perp_price_update_multiplier` |
| equity discovery bound | the equity mark "is clamped to the discovery bound", `discoveryBoundBand` 0.85 to 1.15 on `AAPL.US_USDC_PERP` | per market | S3, Probed |

The update cap means that in a fast move the index and the mark trail the market by construction.
At one update a second, which is what the socket shows, a 2 % BTC move needs at least 8 s to reach the BTC index.
The largest move between two one-second polls over three runs was 2,307 ppm on the `MET_USDC_PERP` index and 2,466 ppm on the `TIA_USDC_PERP` mark, tag `poll_max_step`.
Both markets carry the 0.5 % cap, so neither reached its 5,000 ppm limit.
The largest mark to index gap at the end of each run was 2,038 ppm on `KMNO_USDC_PERP`, 1,995 ppm and 2,255 ppm on `PENDLE_USDC_PERP`, and 21, 23 and 21 of 92 markets sat between 1,000 and 5,000 ppm, tag `premium_top`.
No cluster of markets at one gap was seen, so no mark bound was visibly binding.

### Funding

The formula, the interest add-on, the cap and floor, and the factor of 8 the wire contradicts are in [`fees.md`](./fees.md) section 6.

### Rate across a settlement

The published rate is the running estimate for the interval still in progress.
At 03:23 and at 03:45 the history call listed a row for the interval ending at 04:00, and its rate equalled the `markPrices` rate on every symbol read except `KMNO_USDC_PERP` in the second run, tag `funding_history`.

```json
[{"fundingRate":"0.0000125","intervalEndTimestamp":"2026-09-23T04:00:00","symbol":"BTC_USDC_PERP"},{"fundingRate":"0.000010077","intervalEndTimestamp":"2026-09-23T03:00:00","symbol":"BTC_USDC_PERP"}]
```

`KMNO_USDC_PERP` read `0.000243856` in the history and `0.0002438565367033305404731178` in `markPrices` at 03:23, so the history rounds to nine decimals.
At 03:45 it read `0.000224608` against `0.0002248030219098173699277021`, with the two calls several seconds apart on a rate that moves every second.
The rate moved on almost every poll for most markets, a median of 56 to 58 distinct values in 60 polls, and was constant on 40 and 41 of 92, among them `BTC_USDC_PERP` at 0.0000125, tags `poll_distinct_values_per_symbol` and `poll_rate_constant`.
The settlement instant itself was not captured.
So the value the rate holds at the hour, and whether `nextFundingTimestamp` rolls forward on the hour or later, are Not verified.

### How often each number changed

Over 60 one-second polls, run three times.

| number | median distinct values per market | max | BTC | evidence |
|---|---:|---:|---:|---|
| `indexPrice` | 39, 39 and 40 | 46, 53 and 48 | 46, 50 and 46 | tag `poll_distinct_values_per_symbol` |
| `markPrice` | 22, 13 and 15 | 50, 58 and 54 | 50, 37 and 49 | same |
| `fundingRate` | 56, 58 and 58 | 56, 58 and 58 | 1 in each run | same |
| `nextFundingTimestamp` | 1 | 1 | 1 | same |

The socket's `markPrice.<symbol>` stream published once a second for every market, on the same millisecond of each second, see [`websocket.md`](./websocket.md) section 2.
So the venue republishes every second, and the CDN adds about one second of age to a REST read.

## 5. REST book snapshot

| item | documented | probed |
|---|---|---|
| call | `GET /api/v1/depth?symbol=&limit=`, S1 | `BTC_USDC_PERP` at `limit` 5, 20 and 1000 returned exactly that many levels a side |
| `limit` values | enum `5`, `10`, `20`, `50`, `100`, `500`, `1000`, and "If omitted, up to `5000` levels are returned", S1. The changelog of 2025-11-10 says "Set a default limit of `1000` levels each side" | no `limit` returned 2,366 and 2,365 bids and 1,235 asks, 77 KB. `limit=30` answered 400 with a parse error, section 6 |
| level order | Not publicly specified | bids ascending, so the best bid is the last element. Asks ascending, best first. Same at every limit, tag `depth` |
| fields | `bids`, `asks`, `lastUpdateId` string, `timestamp` µs | as documented, `timestamp` 47 to 231 ms before arrival |
| caching | | none: `x-cache: Miss from cloudfront` and `lastUpdateId` advanced on each of four calls 250 ms apart |
| time | | 102 to 114 ms warm for 5 or 20 levels with calls at 363 and 379 ms, and 191 to 552 ms for 1,000 or all |
| price strings | | `"86700"` where the socket writes `"86700.0"`, so a book keyed by string breaks, see [`websocket.md`](./websocket.md) section 4 |
| seeding all perpetuals | | 91 calls at `limit=1000`, 5 per second, run twice: 91 of 91 answered 200 in 22 s and 20 s, median 112 and 109 ms, max 507 and 426 ms, 338 and 339 KB in total. 2 markets reached 1,000 levels on a side, 7 and 5 had fewer than 20 bids, 7 and 5 fewer than 20 asks, and none was one-sided, tag `seed` |

CCXT's docstring says "default 100, max 200", at `server/node_modules/ccxt/js/src/backpack.js` line 906, which is stale against both the specification and the wire.
The bids arrive worst first, so a reader that takes `bids[0]` as the best bid takes the deepest one.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | Not publicly specified. The specification lists a `429` "Too many requests." response and the error code `TOO_MANY_REQUESTS`, S1 | no 429 in any run, at up to 5 requests per second |
| CCXT's assumption | `'rateLimit': 50, // 20 times per second`, at `server/node_modules/ccxt/js/src/backpack.js` line 25 | |
| rate limit headers | | none on any reply, and no `Retry-After` seen |
| error body, semantic | `{"code": <ApiErrorCode>, "message": <string>}`, S1 | `400 {"code":"INVALID_CLIENT_REQUEST","message":"Invalid market symbol"}` for an unknown symbol on `/depth` and `/market`, and `400 {"code":"INVALID_CLIENT_REQUEST","message":"Symbol not found"}` on `/markPrices` for an unknown or a closed market |
| closed market on `/depth` | | `TON_USDC_PERP`, which is `Closed`, answered `404 {"code":"RESOURCE_NOT_FOUND","message":"Not Found"}` |
| error body, parameter parse | | plain text, `` 400 failed to parse parameter `limit`: failed to parse "DepthLimit": Expect a valid enumeration value. ``, and the same shape for a missing `symbol` or a bad `marketType` |
| unknown path | | `404 not found` as plain text |

Every error reply carried `x-cache: Error from cloudfront`, so errors pass through the CDN.

## 7. Server time and clock offset

`GET /api/v1/time` returns the server time as a bare integer in ms, `1790133798064`.
Against the midpoint of each request the offset was 0 to 3 ms on nine of ten samples over two runs, and 90 ms on one sample taken across a slow request, tag `clock_offset_ms`.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.backpack.exchange/api/v1/markPrices` | one call carries index, mark, rate and next settlement for every open perpetual |
| interval source | `fundingIntervalHours` from `GET /api/v1/markets?marketType=PERP`, read at start and every 5 minutes, or the constant 1 | `markPrices` has no interval, every perpetual is 1 h, and the markets reply is cached 300 s at the CDN anyway |
| interval | 1,000 ms, the default | the venue republishes each number once a second |
| cache | read through the CDN, and do not add a nonce | a cached read is about 1 s old and takes about 20 ms, a nonce read is fresh and takes about 135 ms, both inside the reader's 10 s age limit, and the nonce sends every poll to the origin at an unpublished limit |
| freshness | drop a reply whose `age` header exceeds 5 s | `stale-if-error=3600` can serve an hour-old reply during an origin failure, and the rows carry no timestamp of their own |
| row mapping | section 3, key `symbol` | |
| skip | rows whose market is not `Open` in the catalog | `MSFT.US_USDC_PERP` is in the reply at `PostOnly`, where the mark is the index |
| skip or deny | the 17 equity perpetuals, `rwaMarketType` `STOCK` or `INDEX` | outside the US session their index can be an EWMA of their own book, and it barely moved in the overnight session, section 2 |
| rate limit pause | `rateLimitPauseMs` 10,000 | no limit or `Retry-After` is published, so one conservative window |
| known lag | the update cap of 0.25 % to 0.75 % per update | in a fast move index and mark trail the market for several seconds by design, section 4 |

The reply is 13.8 KB, about 1.2 GB a day at one hertz.
The socket's `markPrice.<symbol>` stream carries the same five fields once a second and could replace the poll, see [`websocket.md`](./websocket.md) section 2, but the engine's anchor path today is a REST poller.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Backpack Exchange API, OpenAPI 3.0 specification embedded in the page, with its changelog | https://docs.backpack.exchange/ | 2026-09-22 | Backpack, global | endpoints, schemas, enums, depth limits, error codes, update cap fields, sections 1 to 6 |
| S2 | Futures Specs | https://support.backpack.exchange/technical-docs/trading/futures-specs | 2026-09-22 | Backpack, global | index, mark and mark bound, section 4 |
| S3 | Equity Futures Specs | https://support.backpack.exchange/technical-docs/trading/equity-futures-specs | 2026-09-22 | Backpack, global | equity oracle, EWMA off session, discovery bound, per-update cap, sections 2 and 4 |
| S4 | CCXT 4.5.68 `backpack.js` | `server/node_modules/ccxt/js/src/backpack.js` | 2026-09-22 | CCXT | market mapping, rate limit, depth docstring, sections 2, 5 and 6 |
| P1 | `rest-probe.mjs main` at 03:23 UTC and in the second pass at 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 3, 5, 6 and 7 |
| P2 | `rest-probe.mjs poll` at 03:24 and 03:34 UTC and in the second pass at 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 3 and 4 |
| P3 | `rest-probe.mjs seed` at 03:36 UTC and in the second pass at 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/backpack/rest-probe.mjs) | 2026-09-22 | this host | section 5 |
