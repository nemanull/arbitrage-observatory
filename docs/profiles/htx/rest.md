# HTX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, from the development host near Seattle, 03:08 to 03:46 UTC on 2026-09-23.

This profile covers the public REST API of HTX futures (CCXT id `htx`) for the USDT-margined perpetuals in detail and the coin-margined perpetuals where they differ.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) in two runs about fifteen minutes apart, and a pair such as "310 and 300 ms" gives the first run and then the second.
The API documentation of record is the USDT-M reference at `huobiapi.github.io`, whose changelog ends at 1.1.8 on 2022-11-10, S1.
HTX moved USDT-M account, order and position calls to a V5 API with a migration deadline of 2026-09-19 16:00 UTC, and "market data interfaces" were excluded from that migration, S2, so the V1 market calls below are current.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 | role |
|---|---|---|
| `api.hbdm.com` | CNAME `api.hbdm.com.eo.dnse3.com`, one address `43.174.196.193` | futures REST and WebSocket |
| `api.hbdm.vn` | CNAME `api.hbdm.vn.eo.dnse3.com`, the same `43.174.196.193` | the host S1 recommends "If your server is deployed in AWS", and the host CCXT uses |
| `api.huobi.pro` | CNAME `d3b78lpogv2hld.cloudfront.net`, four addresses | spot only |

Futures replies carry `server: openresty` and an `eo-cache-status: MISS` header, so a CDN fronts them, and no reply was served from its cache.
S1 recommends "the server in AWS Tokyo C zone and use the api.hbdm.vn domain".

| request | connect | first byte | total |
|---|---:|---:|---:|
| cold `swap_contract_info?business_type=all` on `api.hbdm.com`, 179,054 bytes | 72 ms | 635 ms | 1,009 ms |
| cold, same call on `api.hbdm.vn` | 91 ms | 644 ms | 980 ms |
| warm `swap_index`, 60 polls, P2 | | | median 310 and 300 ms, max 742 and 776 ms |
| warm mark price kline, 240 and 300 calls, P2 | | | median 297 and 297 ms, max 1,500 and 694 ms |
| warm `/api/v1/timestamp`, five reads, P6 | | | 284 to 452 ms round trip |

Every warm call costs about 300 ms from this host, most of it distance.
No request was refused, rate limited or geoblocked in either run.

## 2. Catalog

### The instruments call

`GET /linear-swap-api/v1/swap_contract_info` lists USDT-M contracts, and `business_type=swap` returned 357 rows in 176,892 bytes, while `business_type=all` adds the 4 dated futures for 361 rows, P1.
`GET /swap-api/v1/swap_contract_info` lists the 5 coin-M perpetuals, and `GET /api/v1/contract_contract_info` the 8 coin-M dated futures.

| field | meaning | observed |
|---|---|---|
| `contract_code` | the id, `BTC-USDT` | also 4 contracts named in Chinese, `龙虾-USDT`, `牛来-USDT`, `哈基米-USDT`, `币安人生-USDT`, all active |
| `contract_status` | 1 listing, 3 suspension, and the other values 0 to 9 that CCXT lists at `server/node_modules/ccxt/js/src/htx.js` lines 1986 to 1995 | 353 at 1, and `CYBER-USDT`, `H-USDT`, `BLESS-USDT`, `BSB-USDT` at 3 |
| `contract_size` | coins per contract | 11 distinct values, from 0.0001 to 1,000,000 |
| `settlement_period` | funding interval in hours, a string | `"8"` on 248, `"4"` on 93, `"1"` on 16 |
| `settlement_date` | next funding settlement, Unix ms as a string | equal to `funding_time` of the batch funding call on 357 of 357 rows, P3 |
| `tradfi_labels` | TradFi class | non-empty on 223 of the 353 active swaps, section 2 below |
| `enable_rpi` | retail price improvement orders allowed | true only on `FIL-USDT` |

### How CCXT 4.5.68 maps it

`loadMarkets` took 1,831 and 1,608 ms and returned 2,539 markets, P1.

| CCXT field | source | line in `server/node_modules/ccxt/js/src/htx.js` | observed |
|---|---|---|---|
| families loaded | `options.fetchMarkets.types` spot, linear and inverse | 878 to 884 | all three |
| linear request | `business_type` `all` | 1772 | USDT-M swaps and futures in one call |
| `id` | `contract_code` | 1894 | `BTC-USDT` |
| `swap` or `future` | `delivery_date` present or not | 1896 and 1898 | 362 swaps, 358 of them active, and 12 futures |
| `linear` | `business_type` present | 1897 and 1900 | USDT-M true, coin-M false |
| `contractSize` | `contract_size` | 1948 | equal to the catalog on every row |
| `active` | `contract_status === 1` | 1981 | 353 USDT-M and 5 coin-M active, 4 inactive |
| `taker`, `maker` | constants | 1978 and 1979 | 0.0005 and 0.0002, see [`fees.md`](./fees.md) section 8 |

The engine keeps active swaps, so it would load 358 markets: 353 USDT-M and 5 coin-M.

| check | result, P1 |
|---|---|
| `market.id` against the socket | the channel `market.BTC-USDT.depth.size_20.high_freq` carries the same code, see [`websocket.md`](./websocket.md) section 3 |
| `market.id` against the anchor calls | all 353 active USDT-M ids appear in `swap_index` and in `swap_batch_funding_rate` |
| `contractSize` against the book size unit | books count contracts, and one contract is `contract_size` coins, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | true on every USDT-M swap |
| `active` | false on the 4 suspended contracts |

### Size unit, pairs listed twice, and price scale

| contract | `contract_size` | meaning |
|---|---:|---|
| `BTC-USDT` | 0.001 | one contract is 0.001 BTC |
| `ETH-USDT` | 0.01 | 0.01 ETH |
| `DOGE-USDT` | 100 | 100 DOGE |
| `STEEM-USDT` | 1 | 1 STEEM |
| `XAU-USDT` | 0.001 | 0.001 troy ounce |
| `NVDA-USDT` | 0.01 | 0.01 share |
| `BTC-USD` | 100 | 100 US dollars of face value, an inverse contract |

Five pairs are listed twice, once per family: `BTC`, `ETH`, `DOGE`, `XRP` and `TRX` each have a USDT-M and a coin-M perpetual.
CCXT gives the coin-M contract `contractSize` 100 or 10 with `linear` false, and those are US dollars of face value, so the engine would read 100 contracts as 10,000 BTC.
The engine's one market per pair rule needs a `marketFilter` that keeps `linear` markets, see [`../../../server/src/ccxt/types.ts`](../../../server/src/ccxt/types.ts).

No base carries a `1000` or other multiplier prefix, and HTX expresses small prices through `contract_size` instead, so no price scale is needed.

### TradFi contracts

The 353 active USDT-M swaps are 130 crypto and 223 TradFi: 179 labelled Stocks, 27 Stocks and Indices, 7 Metals, 7 Indices and 3 Commodities.
Their bases are share tickers and commodity codes, and several are spelled like crypto tickers, among them `BNC`, `BOT`, `META`, `PENG` and `PURR`.
The list also holds `OPENAI` and `ANTHROPIC`, labelled Stocks.
`PAXG` and `XAUT` are labelled Metals although they are tokens on other venues.
A `marketFilter` on `info.tradfi_labels` being empty keeps the 130 crypto swaps, and a `DENIED_PAIRS` line is the alternative per ticker.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time over 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /linear-swap-api/v1/swap_index` | `index_price`, with `index_ts` in ms | | | | | 40,896 and 40,898 bytes, 373 rows | min 274 and 285, median 310 and 300, p90 657 and 649, max 742 and 776 ms |
| `GET /linear-swap-api/v1/swap_batch_funding_rate` | | | `funding_rate` | | `funding_time`, Unix ms string | 71,323 and 71,308 bytes, 361 rows | min 392 and 392, median 442 and 528, p90 782 and 869, max 984 and 1,037 ms |
| `GET /linear-swap-api/v1/swap_contract_info?business_type=swap` | | | | `settlement_period`, hours | `settlement_date` | 176,892 bytes, 357 rows | 321 and 312 ms, single reads |
| `GET /index/market/history/linear_swap_mark_price_kline?contract_code=<id>&period=1min&size=1` | | `data[0].close` | | | | 222 to 224 bytes, one contract | median 297 and 297, p90 395 and 358, max 1,500 and 694 ms |
| `GET /v5/market/funding_rate?contract_code=<id>,<id>` | | | `funding_rate` | | `funding_time` and `next_funding_time` | up to 10 codes, 20 answered code 1067 | not timed |

No call returns a mark price for many contracts at once.
The mark exists only per contract, as the close of a one minute mark price kline, on REST above and on the `ws_index` socket, see [`websocket.md`](./websocket.md) section 2.
`GET /linear-swap-api/v1/swap_mark_price` and `GET /v5/market/mark_price` answered 404, and `/v5/market/index_price` and `/v5/market/premium_index` answered 404.
One round of mark reads over the 130 crypto swaps at ten requests in flight took 4,729 and 4,519 ms with no error, `rest-probe.mjs marks`, P7.

`swap_index` holds 16 more rows than the catalog, all delisted contracts with frozen values, `CVX-USDT` among them with an `index_ts` of 1747706678010, 2025-05-20.
It omits the dated futures.
The V5 funding call is not in S1, and it was found by probing, so its contract is Not publicly specified.
The coin-M family has the same shape under `/swap-api/v1/swap_index`, `/swap-api/v1/swap_batch_funding_rate` and `/index/market/history/swap_mark_price_kline`, each answering 200 on 2026-09-23.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `contract_code` | string, `BTC-USDT` | none |
| `index` | `swap_index` `index_price` | JSON number, `86812.90428571429` | none |
| `mark` | mark kline `data[0].close` | decimal string, `"86779.9"` | `Number()` |
| `fundingRate` | `swap_batch_funding_rate` `funding_rate` | decimal string, a fraction per interval, and `"0E-18"` for an exact zero | `Number()` |
| `fundingIntervalHours` | `swap_contract_info` `settlement_period` | string of hours, `"8"`, `"4"`, `"1"` | `Number()` |
| `nextFundingAt` | `swap_batch_funding_rate` `funding_time` | Unix ms string, `"1790150400000"` is 2026-09-23 08:00 UTC | `Number()` |

`estimated_rate` and `next_funding_time` were null on all 361 rows in both runs, although S1 documents both as filled.
`funding_rate` was null on the 4 dated futures.

## 4. Anchor semantics

### Index

HTX's article on index rules, S4, says the index "performs a weighted average based on the latest transaction prices of multiple exchanges", sampled every second.
A venue more than ±3 % from the median of all venues is clamped to ±3 % of the median, and for USDT the band is ±0.3 %.
A venue with fewer than 10 valid points in the last 100 (10 minutes) is weighted 0 until it recovers.
The article sits in the coin-M guides and says "The index of the perpetual swaps and the index of the futures contract are from the same index system", and no USDT-M version was found.
No public call returns the basket or the weights, so a self-referential basket like the one in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) cannot be screened from the API.

On the wire 361 of the 373 rows of one reply carried the same `index_ts` in two reads, and 352 plus 9 one second older in a third, so the index is computed for nearly all contracts at once.
The BTC `index_ts` changed on 53 and 52 of 59 poll intervals, the XAU and NVDA ones on 59, and the BTC index read 574 to 2,162 ms old on arrival, median 817 ms, in the second run.
`NVDA-USDT` changed its index on 56 of 59 intervals at 03:39 UTC, while US exchanges were closed, so the stock index keeps a source outside market hours, and that source is Not publicly specified.

### Mark

No HTX page reachable from this host states the mark price formula or a clamp, so both are Not publicly specified here.
The wire shows a mark that follows the perpetual's own book rather than the index.

| contract | mark minus index | mark minus bulk bbo mid |
|---|---|---|
| `BTC-USDT` | -694 to -348 ppm | -345 to +32 ppm |
| `ETH-USDT` | -1,230 to -378 ppm | -1,092 to +96 ppm |
| `STEEM-USDT` | -3,019 to -2,352 ppm | +335 to +1,172 ppm |
| `XAU-USDT` | +1,445 to +1,722 ppm | -98 to +139 ppm |
| `NVDA-USDT` | -182 to +68 ppm | -634 to -350 ppm |

These are 60 one second polls of the second run, where the mark and the mid were read in the same round, P2.
The first run read BTC mark minus index at -465 to -176 ppm.
So the mark premium on HTX is close to the perpetual's own basis, and a fresh reading built from it measures the book it is meant to check, which is the risk the design names for a clamped or self-referential mark.

### Funding

The formula, the 5 s premium sampling and the caps are in [`fees.md`](./fees.md) section 6.
The rate published by the batch call is the live rate of the current period, charged at `funding_time`, and it "may fluctuate until the funding payment deadline", S3.
The funding history call, `GET /linear-swap-api/v1/swap_historical_funding_rate`, carries `funding_rate` and `avg_premium_index` per settled period and a `realized_rate` that was null, P3.

| contract | last settled | rate at settlement | live rate at 03:33 to 03:40 UTC |
|---|---|---|---|
| `BTC-USDT` | 2026-09-23 00:00 UTC | 0.0000087 | 0.0000661 to 0.0000665 |
| `LSK-USDT`, 1 h | 2026-09-23 03:00 UTC | -0.000402 | -0.000224 to -0.000270 |
| `XAU-USDT`, 4 h | 2026-09-23 00:00 UTC | 0.000166 | 0.000174 to 0.000178 |

The settlement instant itself was not captured, so whether the published rate resets after the hour is Not verified.

### Rate across a settlement

Not captured, by the rule of this survey.
The batch call's `funding_time` equalled `settlement_date` on every row, and the `public.*.funding_rate` socket topic carries both a `funding_time` that is the 5 s computation instant and a `settlement_time` that is the settlement instant, see [`websocket.md`](./websocket.md) section 6.

### How often each number changed

60 one second polls per run, P2.

| contract | index changed | mark changed | funding rate changed |
|---|---|---|---|
| `BTC-USDT` | 48 and 44 | 52 and 33 | 11 and 12 |
| `ETH-USDT` | 53 and 47 | 56 and 44 | 0 and 12 |
| `DOGE-USDT`, first run | 47 | 51 | 0 |
| `STEEM-USDT`, second run | 1 | 3 | 12 |
| `XAU-USDT`, second run | 59 | 35 | 12 |
| `NVDA-USDT`, second run | 56 | 25 | 0 |

The funding rate moves in steps about 5 s apart, and it stays still while it sits on the 0.0001 interest floor, as ETH and DOGE did in the first run, or at 0 as `NVDA-USDT` did.
318 and 316 of the 373 index rows changed at least once in a minute.
The mark kline on the socket pushed 25 frames with 21 distinct closes in about 24 s, see [`websocket.md`](./websocket.md) section 2.

## 5. REST book snapshot

`GET /linear-swap-ex/market/depth?contract_code=<id>&type=step0` returns 150 levels per side, and `type=step6` returns 30, where S1 says step6 is "20 steps".

| read, P4 | levels | order | time | tick age on arrival |
|---|---|---|---|---|
| `BTC-USDT` step0 | 150 and 150 | bids descending, asks ascending | 458, 408 and 458 ms | 223, 200 and 248 ms |
| `BTC-USDT` step6 | 30 and 30 | same | 300, 305 and 298 ms | 239, 220 and 196 ms |
| `STEEM-USDT` step0 | 43 bids and 51 asks | same | 295 ms | 1,126 ms |
| `CYBER-USDT` step0, suspended | 0 and 0, `status` `ok` | | 292 ms | `id` 1767859185, 2026-01-08 |

The reply has no `Cache-Control` header.
Six reads 50 ms apart saw `tick.ts` advance by 300 to 400 ms each time, and `tick.version` is the Unix second, not the socket's `version`.
A code not in the catalog, such as `ONE-USDT`, answers `err-msg` `contract_code data error or empty`.
`GET /linear-swap-ex/market/bbo?business_type=swap` returns every best bid and ask in one call, 55,869 bytes and 355 rows.

## 6. Rate limits and errors

| limit, S1 | value |
|---|---|
| public non-market data "index, price limit, delivery and settlement, positions" | 240 per 3 s per IP |
| public market data, which S1 says includes klines, the market overview, contract information and depth | 800 per second per IP for REST |
| WebSocket `req` | 50 per second |
| WebSocket subscriptions | "40 subscriptions at most can be sent in one second" |

| call | headers seen, P5 |
|---|---|
| `swap_index`, `swap_batch_funding_rate`, `swap_contract_info` | `ratelimit-limit: 240`, `ratelimit-interval: 3000`, `ratelimit-remaining` counting down 239, 238, 237 across the three, `ratelimit-reset` in Unix ms |
| `market/depth`, mark price kline | no rate limit header |

S1 counts contract information as market data, and the wire counts `swap_contract_info` against the 240 per 3 s budget instead.
So the anchor's index and funding calls share one 240 per 3 s budget with the catalog, and a one second poll of both uses 6 of it.
The mark kline counts against the market data budget, which carries no header to watch.
No `Retry-After` header appeared on any reply.

| request | HTTP | body |
|---|---|---|
| depth of `NOPE-USDT` | 200 | `{"ts":…,"status":"error","err-code":"invalid-parameter","err-msg":"contract_code data error or empty"}` |
| depth `type=step99` | 200 | `"err-code":"invalid-parameter","err-msg":"invalid type:step99"` |
| `swap_index?contract_code=NOPE-USDT` | 200 | `{"status":"error","err_code":1014,"err_msg":"This contract doesnt exist.","ts":…}` |
| mark kline of `NOPE-USDT` | 200 | `"err-code":"invalid-parameter","err-msg":"invalid  symbol"` |
| `/linear-swap-api/v1/nope` | 404 | `{"timestamp":"2026-09-23T03:38:42.568+00:00","status":404,"error":"Not Found","path":"/linear-swap-api/v1/nope"}` |

Errors arrive as HTTP 200 with `status` `error`, spelled `err-code` on market calls and `err_code` with a number on API calls.
S1 names code 1032 "The number of access exceeded the limit." for a rate limit, and lists HTTP 429 "too many requests" in its WebSocket error table, and neither was provoked here.
A 1032 in a 200 body is the case [`../../../server/src/shared/errors.ts`](../../../server/src/shared/errors.ts) line 17 describes for MEXC.

## 7. Server time and clock offset

`GET /api/v1/timestamp` returns `{"status":"ok","ts":…}` in ms.
Five reads per run gave offsets of 57, 5, -13, 3 and 7 ms and then 80, 1, 12, 2 and 9 ms, where the 57 and 80 ms readings had the slowest round trips of 384 and 452 ms, P6.
The host clock is within about 10 ms of HTX.
`GET /heartbeat/` answers every status 1 but a fixed `ts` of 1557714418033, a 2019 instant, so its timestamp is not a clock.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| index | `https://api.hbdm.vn/linear-swap-api/v1/swap_index` every 1,000 ms | one call, all contracts, republished about once a second |
| funding rate and next settlement | `https://api.hbdm.vn/linear-swap-api/v1/swap_batch_funding_rate` every 1,000 ms | one call, all contracts, the rate moves every 5 s |
| interval | `swap_contract_info?business_type=swap` every 60 s, cached | `settlement_period` changes rarely, and the call costs one of the 240 per 3 s |
| mark | no bulk call exists, so either one mark kline call per tracked contract per round, or the `ws_index` subscription of [`websocket.md`](./websocket.md) section 8 | 130 calls took 4.5 to 4.7 s at ten in flight, so a one second round needs about 45 in flight, about 130 requests per second against the 800 per second market budget |
| row mapping | section 3, key `contract_code` | |
| skip | rows not in the tracked catalog, since `swap_index` keeps 16 delisted rows with frozen values | `CVX-USDT` read an `index_ts` from 2025-05-20 |
| skip | `contract_status` not 1 | suspended contracts keep an empty book and an old funding row |
| stale index | refuse a row whose `index_ts` is more than a few seconds old | the engine stamps on arrival, and `index_ts` read up to 2.2 s old on arrival |
| rate limit | treat a 200 body with `err_code` 1032 as a rate limit, and pause 3,000 ms | the window is 3 s, and no `Retry-After` exists |
| mark caveat | flag the HTX mark as tracking its own book | section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Huobi USDT Margined Contracts API reference, changelog to 1.1.8 of 2022-11-10 | https://huobiapi.github.io/docs/usdt_swap/v1/en/ | 2026-09-22 | HTX, USDT-M | endpoints, fields, limits, error codes, AWS advice, sections 1 to 6 |
| S2 | HTX's USDT-M Futures Trading System Upgrade and the Migration Deadline, published 2026-09-03 | https://www.htx.com/support/65042754281336 | 2026-09-22 | HTX, USDT-M | V5 migration scope, market data excluded |
| S3 | Funding Calculation, published 2024-04-29 | https://www.htx.com/support/900001326466 | 2026-09-22 | HTX, USDT-M | live rate, section 4 |
| S4 | Index Calculation Rules, published 2021-02-01, coin-M guides | https://www.htx.com/support/900000089963 | 2026-09-22 | HTX, coin-M | index method and clamps, section 4 |
| S5 | CCXT 4.5.68 `htx.js` | `server/node_modules/ccxt/js/src/htx.js` | 2026-09-22 | CCXT | catalog mapping, section 2 |
| P1 | `rest-probe.mjs catalog` at 03:23 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | section 2 |
| P2 | `rest-probe.mjs anchor` at 03:23 and 03:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3 and 4 |
| P3 | `rest-probe.mjs funding` at 03:33 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 4 |
| P4 | `rest-probe.mjs book` at 03:33, 03:38 and 03:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P5 | `rest-probe.mjs limits` at 03:33 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
| P6 | `rest-probe.mjs time` at 03:33 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 7 |
| P7 | `rest-probe.mjs marks` at 03:36 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/htx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 8 |
