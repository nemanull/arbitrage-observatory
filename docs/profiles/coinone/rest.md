# Coinone REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:15 to 03:41 UTC), from the development host near Seattle.

This profile covers the public REST API v2 of Coinone (CCXT id `coinone`), whose only market is KRW spot.
Coinone lists no perpetual, so section 3 records that there is no index, mark or funding, and section 8 recommends no anchor poller, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coinone/rest-probe.mjs), a source id from section 9, or a CCXT file and line.
The probe ran twice, first from 03:20 UTC and again for the second pass, and both readings are written where they differ.

## 1. Host and latency from this machine

| host | resolved to | edge |
|---|---|---|
| `api.coinone.co.kr` | `104.17.65.46`, `104.17.66.46`, `2606:4700::6811:412e`, `2606:4700::6811:422e` | Cloudflare, `server: cloudflare`, `cf-ray` suffix `SEA` in the first run and `YVR` in the rerun, `cf-cache-status: DYNAMIC` on every reply |
| `stream.coinone.co.kr` | CNAME `k8s-interfac-openwebs-28e8807527-515518576.ap-northeast-2.elb.amazonaws.com`, `13.209.171.175`, `54.180.225.242` | AWS load balancer in Seoul, not Cloudflare |
| `docs.coinone.co.kr` | `104.17.65.46`, `104.17.66.46` | Cloudflare, readme.io documentation |

| call | reply | cold, first run and rerun | warm, 10 requests 250 ms apart, first run | warm, rerun |
|---|---|---|---|---|
| `GET /public/v2/markets/KRW` | 138,009 bytes | 919 and 422 ms | min 167, median 526, max 684 ms | min 149, median 364, max 641 ms |
| `GET /public/v2/ticker_new/KRW` | 116,884 and 116,923 bytes | 166 and 157 ms | min 160, median 164, max 176 ms | min 152, median 158, max 161 ms |
| `GET /public/v2/ticker_new/KRW/BTC` | 435 and 439 bytes | 149 and 142 ms | min 145, median 148, max 151 ms | min 141, median 144, max 148 ms |
| `GET /public/v2/orderbook/KRW/BTC?size=16` | 1,459 and 1,470 bytes | 150 and 158 ms | min 145, median 151, max 165 ms | min 143, median 144, max 173 ms |

Every public call answered HTTP 200 with data, and none was refused or geoblocked.
The replies are gzip encoded when the client asks, and Cloudflare does not cache them.
The `markets` call is the slow one: its warm median was two to three times the ticker's, and its first request took 856 and 708 ms in the catalog mode and 919 and 422 ms in the latency mode.

## 2. Catalog

### The instruments call

`GET https://api.coinone.co.kr/public/v2/markets/KRW` returns every KRW pair, S1.

| field | meaning | on 2026-09-23 03:20 UTC |
|---|---|---|
| `quote_currency`, `target_currency` | the pair, upper case | `KRW` and 363 bases |
| `trade_status` | 0 no trading, 1 buy and sell, 2 no buy, 3 no sell, S1 | 1 on all 363 |
| `maintenance_status` | 0 normal, 1 under maintenance, S1 | 0 on all 363 |
| `order_types` | `limit`, `market`, `stop_limit` | all three on all 363 |
| `price_unit` | tick size, marked in the documentation as due for removal in favour of `range_units`, S1 | `10000.0` on BTC |
| `qty_unit`, `min_qty`, `min_order_amount` | quantity step, minimum quantity, minimum order value in KRW | `0.00000001`, `0.00000001` and `5000.0` on BTC |
| `order_book_units` | aggregation steps for the REST book | `["0.0","100000.0","1000000.0"]` on BTC |

`GET /public/v2/markets/USDT`, `/BTC` and `/USDC` each returned an empty `markets` array in both runs, as in the rerun's USDT reply `{"result":"success","error_code":"0","server_time":1790134779665,"markets":[]}`.
So KRW is the only quote.
The active count is 363 KRW spot pairs and 0 perpetuals.

### How CCXT 4.5.68 maps it

| CCXT field | value | source |
|---|---|---|
| source call | `GET /public/v2/ticker_new/KRW`, not the `markets` call | `server/node_modules/ccxt/js/src/coinone.js` lines 372 to 376 |
| `market.id` | the ticker row's `id`, a numeric string such as `1790133603790001` | lines 414 and 420 |
| `symbol`, `base`, `quote` | `BTC/KRW`, `BTC`, `KRW` | lines 415 to 421 |
| `baseId` | upper cased `target_currency`, `BTC` | line 415 |
| `type`, `spot`, `swap` | `spot`, `true`, `false` | lines 428 to 433 |
| `active` | undefined | line 434 |
| `linear` | undefined | line 436 |
| `contractSize` | undefined | line 438 |
| `precision` | amount and price fixed at `1e-4` for every pair | lines 443 to 447 |
| `taker`, `maker` | `0.002` from the exchange-wide constant | line 226, see [`fees.md`](./fees.md) section 8 |

The probe loaded the markets twice, 2 s apart, P1.

| measure | first run, load 1 | first run, load 2 | rerun, load 1 | rerun, load 2 |
|---|---|---|---|---|
| markets | 363 | 363 | 363 | 363 |
| `market.id` all digits | 363 | 363 | 363 | 363 |
| distinct `market.id` values | 114 | 199 | 358 | 358 |
| `BTC/KRW` `market.id` | `1790133603790001` | `1790133605120001` | `1790134770660001` | `1790134770660001` |

271 of 363 pairs kept the same `market.id` across the two loads of the first run, and 337 in the rerun.
BTC's changed in the first run and not in the rerun.
So `market.id` is the id of the pair's latest ticker update, not a pair identifier.
It changes whenever the row is rewritten, and in the first run many pairs shared one value, which suggests the server rewrites quiet pairs' rows in batches, an inference from the counts.
CCXT indexes markets by `id`, so two pairs that share an `id` collide in its id lookup.
Neither the socket nor any REST path uses it: the socket routes on `target_currency`, and CCXT's own `fetchOrderBook` builds its path from `market.quote` and `market.base`, at lines 521 to 524.
`baseId` matched the `markets` reply's `target_currency` on 363 of 363 pairs, and no base was renamed by CCXT's currency map.
The engine takes `market.id` as `rawMarketId`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 170, so a spot design would have to key Coinone on `baseId` instead.

The fixed `1e-4` precision disagrees with the venue: BTC trades in steps of `0.00000001` BTC and 10,000 KRW.
CCXT's API table still lists `range_units` at line 148, which the changelog removed on 2024-12-19, S5, yet `GET /public/v2/range_units` still answered `success` with a table in both runs.

### Size unit, pairs listed twice, and price scale

Sizes are base coins, since this is spot, and CCXT's undefined `contractSize` becomes 1 in the connector, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 175, which is correct here.
No pair is listed twice, and no price scale applies.

## 3. Anchor

Coinone publishes no index price, no mark price and no funding rate, because it has no derivative.
The documentation index lists no reference price, basket or index endpoint of any kind among its public, private and WebSocket pages, S6.
Nothing here maps to an `AnchorRow`.

The bulk call that does exist is `GET https://api.coinone.co.kr/public/v2/ticker_new/KRW`, 363 rows in 116,840 to 116,992 bytes, S2.
Each row carries `quote_currency`, `target_currency`, `timestamp`, `high`, `low`, `first`, `last`, `quote_volume`, `target_volume`, `best_asks`, `best_bids` and `id`, with the base spelled in lower case, as in `"target_currency":"btc"`.
`best_asks` and `best_bids` hold one level each.
`GET /public/v2/ticker_utc_new/KRW` is listed as the same call on UTC day boundaries, S6, and was not probed.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.

What the ticker poll shows instead, over 30 polls of `/public/v2/ticker_new/KRW` at 1 s in each of two runs, P1:

| measure | first run, 03:20 UTC | rerun, 03:40 UTC |
|---|---|---|
| reply time | min 154, median 157, p90 181, max 273 ms | min 150, median 157, p90 166, max 175 ms |
| pairs whose `id`, best bid or best ask changed from one poll to the next | min 0, median 9, max 363 of 363 | min 0, median 7, max 54 of 363 |
| `server_time` minus the BTC row's `timestamp` | min 330, median 2,631, max 12,333 ms | min 31, median 1,149, max 3,775 ms |
| pairs with an empty best bid or best ask | 0 | 0 |
| crossed pairs | 0 | 0 |
| pairs with zero KRW volume in 24 h | 104 of 363 | 101 of 363 |
| median 24 h volume per pair | 198,349 KRW | 203,886 KRW |

The ten largest pairs by 24 h KRW volume were, in both runs and in this order, USDC, USDT, BTC, XRP, ETH, RLUSD, DOGE, WLD, ENA and SOL.
In the rerun they read 49.5, 45.0, 30.9, 24.1, 12.7, 8.2, 6.7, 3.4, 2.5 and 2.0 billion KRW.
So the two largest markets are stablecoins against the won, and the median pair trades about 200,000 KRW a day.
With a median of 7 to 9 changed pairs per 1 s poll, most of the 363 rows stay the same from one second to the next.

## 5. REST book snapshot

`GET https://api.coinone.co.kr/public/v2/orderbook/{quote_currency}/{target_currency}?size=16`, S3.

| item | value | source |
|---|---|---|
| `size` | 5, 10, 15 or 16, default 15 | S3, and P1 returned 15 levels a side by default and exactly 5, 10, 15 and 16 when asked |
| `size=20` | `{"result":"error","error_code":"107","error_msg":"Parameter value is wrong"}` with HTTP 200 | P1 |
| `order_book_unit` | aggregation step taken from the `markets` reply, default `0.0` | S3 |
| bids | best first, descending, on BTC, XRP and TNSR at every size | P1 |
| asks | best first, ascending, on the same | P1 |
| other fields | `timestamp`, `id`, `quote_currency`, `target_currency`, `order_book_unit` | P1 |
| caching | none seen: `cf-cache-status: DYNAMIC`, and 8 reads of BTC 250 ms apart returned 7 distinct `id`s in the first run and 8 in the rerun, the first run's one repeat being a book that had not changed | P1 |
| lower case path | `/orderbook/krw/btc` returns the BTC book | P1 |

The REST `id` is the socket's `id`: in both runs a REST read and the last socket frame carried the same `id`, and all 16 levels a side were equal, see [`websocket.md`](./websocket.md) section 4.
The `timestamp` is the book's last change, so a quiet book reads old: TNSR was 28.8 to 30.6 s old at every size in the first run and 10.8 to 12.6 s in the rerun, while BTC read 81 to 1,613 ms old over both runs.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public V2 limit | 1,200 requests per minute per IP, S4 | `public-ratelimit-remaining` between 1197 and 1199, `public-ratelimit-replenish-rate: 20` and `public-ratelimit-burst-capacity: 1200` on every JSON reply, so a token bucket of 1,200 refilled at 20 per second |
| public V1 limit | 600 per minute per IP, and each V1 call costs 2, S4 | not probed |
| over the limit | body `{"result":"error","error_code":"4","error_msg":"Blocked user access"}`, S4. The HTTP status is not documented | not provoked. The probe stayed under 5 requests per second |
| `Retry-After` | not documented | never seen |
| header presence | "included only while requests remain", S4 | present on every JSON reply the probe logged |

Errors come back with HTTP 200 and `"result":"error"`, so a client has to read the body.

| request | status | body |
|---|---|---|
| `/public/v2/orderbook/KRW/NOPE` | 200 | `{"result":"error","error_code":"108","error_msg":"Unknown CryptoCurrency"}` |
| `/public/v2/ticker_new/KRW/NOPE` | 200 | the same `108` |
| `/public/v2/orderbook/KRW/BTC?size=20` | 200 | `107` `Parameter value is wrong` |
| `/public/v2/ticker_new/USDT` | 200 | `{"result":"success","error_code":"0","server_time":1790133696895,"tickers":[]}` |
| `/public/v2/nope` | 200 | an HTML page of the readme.io documentation site |

The documented code table names `4` "Blocked user access", `107` "Parameter error" and `108` "Unknown cryptocurrency", S7.

## 7. Server time and clock offset

There is no dedicated time call.
Every `ticker_new` and `markets` reply carries `server_time` in Unix ms.
Ten reads of `ticker_new/KRW/BTC` 300 ms apart put `server_time` 4 to 7 ms ahead of the local midpoint of each request, and 4 to 11 ms in the rerun, median 6 ms both times, P1.

## 8. Recommended poller shape

None.
There is no index, mark or funding to poll.
A spot design that wanted a second opinion on the touch could read `ticker_new/KRW` once a second, 363 rows in about 117 KB at a median of 157 ms in both runs, but the socket already carries the whole 16 level book for every pair.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 전체 종목 정보 조회 (all markets) | https://docs.coinone.co.kr/reference/markets | 2026-09-22 | Coinone | `markets` fields, `trade_status` and `maintenance_status` values, section 2 |
| S2 | 전체 티커 정보 조회 (all tickers) | https://docs.coinone.co.kr/reference/tickers | 2026-09-22 | Coinone | `ticker_new` call and fields, section 3 |
| S3 | 오더북 조회 (order book) | https://docs.coinone.co.kr/reference/orderbook | 2026-09-22 | Coinone | `size` values and default, `order_book_unit`, section 5 |
| S4 | API 요청건수 제한 안내 (rate limits), page updated 2026-09-08 | https://docs.coinone.co.kr/docs/ratelimit-안내 | 2026-09-22 | Coinone | 1,200 and 600 per minute per IP, error body, remaining header, section 6 |
| S5 | Changelog, tick size API removed and added | https://docs.coinone.co.kr/changelog/호가-단위-조회-api-제거-및-신규-추가-안내 | 2026-09-22 | Coinone | `range_units` removed on 2024-12-19, per pair `range_units/{quote}/{target}` added on 2024-12-05, section 2 |
| S6 | Coinone developer documentation index | https://docs.coinone.co.kr/llms.txt | 2026-09-22 | Coinone | no index, mark, funding or reference price endpoint, the `ticker_utc_new` page, section 3 |
| S7 | API 에러코드 (error codes) | https://docs.coinone.co.kr/docs/error-code | 2026-09-22 | Coinone | codes 4, 107 and 108, section 6 |
| S8 | CCXT 4.5.68 `coinone.js` | `server/node_modules/ccxt/js/src/coinone.js` | 2026-09-22 | CCXT | `fetchMarkets`, `market.id`, flags, precision, `range_units`, `fetchOrderBook`, section 2 |
| P1 | `rest-probe.mjs catalog`, `latency`, `tickers`, `book` and `errors`, from 03:20 UTC, and the second pass rerun | [`rest-probe.mjs`](../../../scripts/probes/venues/coinone/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `ws-probe.mjs book`, the REST compare | [`ws-probe.mjs`](../../../scripts/probes/venues/coinone/ws-probe.mjs) | 2026-09-22 | this host | REST and socket `id` equal, section 5 |
