# Poloniex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, which was 2026-09-23 03:18 to 03:40 UTC, from the development host near Seattle.

This profile covers the public Futures v3 REST API of Poloniex (CCXT id `poloniex`) for its one perpetual family, USDT-M.
Every number was read by [`rest-probe.mjs`](../../../scripts/probes/venues/poloniex/rest-probe.mjs) or by `curl` at 03:18 and 03:19 UTC, unless a source row says otherwise.
The `main` and `baskets` modes ran twice and the `anchor` mode three times, and a list of numbers follows that order.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| host | `https://api.poloniex.com`, the same host for spot and futures, R1 and `server/node_modules/ccxt/js/src/poloniex.js` lines 123 and 124 | |
| resolved | CNAME `dqbrqt4q5m2ke.cloudfront.net`, A `99.86.101.12`, `.26`, `.44`, `.62` | P1, both runs |
| edge | `x-amz-cf-pop: SEA900-P13` and `x-cache: Miss from cloudfront` on every reply read | P1, P3 |
| cold request | `GET /timestamp` 189 and 177 ms | P1 |
| warm request | `GET /timestamp` median 375 and 114 ms over 5 calls, min 111 and 107, max 383 and 119 | P1 |
| warm bulk anchor calls | median 111 to 114 ms, p90 149 to 208 ms, max 206 to 398 ms, over 60 polls in each of three runs | P3, section 3 |
| refusals | none. Every call answered HTTP 200 except the deliberate unknown path | P1 |

The first run's warm median of 375 ms came from three of five calls at 375 to 383 ms, and every later loop sat near 111 ms.

## 2. Catalog

### The instruments call

`GET /v3/market/allInstruments` returns every contract in one reply of 9,338 bytes, in 374 and 122 ms, R2.

| item | value | evidence |
|---|---|---|
| rows | 18, all `status` `OPEN`, all `ctType` `LINEAR`, all `sCcy` `USDT`, all `alias` `""` | P1, both runs |
| documented status values | `OPEN`, `PAUSED`, `CLOSED`, `CANCEL_ONLY`, `CANCEL_CLOSE_ONLY`, typed "Integer" in R2 and sent as a string | R2, P1 |
| fields | `alias`, `bAsset`, `bCcy`, `ctType`, `ctVal`, `iM`, `lever`, `limitMaxQty`, `lotSz`, `mM`, `mR`, `marketMaxQty`, `maxLever`, `maxPx`, `maxQty`, `minPx`, `minQty`, `minSz`, `oDate`, `ordPxRange`, `pxScale`, `qCcy`, `sCcy`, `status`, `symbol`, `tSz`, `tradableStartTime`, `visibleStartTime` | P1 |
| fee fields | no row carries `tFee` or `mFee`, 0 of 18 | P1 |
| funding fields | none: no interval, rate or cap in the catalog | P1 |
| active perpetuals by settlement asset | USDT 18 | P1 |

The documentation example shows `alias` values for delivery futures such as `this_week` and `quarter`, R2, and none is listed.

### How CCXT 4.5.68 maps it

| item | CCXT | wire | evidence |
|---|---|---|---|
| call | `fetchMarkets` runs `fetchSpotMarkets` and `fetchSwapMarkets` together, the second calling `/v3/market/allInstruments` | | `poloniex.js` lines 728 to 731 and 762 |
| `market.id` | `symbol`, `BTC_USDT_PERP` | the same string on the socket, in every anchor reply and in the funding call, 18 of 18 | P1, [`websocket.md`](./websocket.md) section 3 |
| `symbol` | `BTC/USDT:USDT` | | P1 |
| `type` | `swap` when `alias` is undefined, `future` otherwise, lines 921 to 926 | `alias` is `""` on every row, and CCXT still typed 18 of 18 as `swap` with `swap: true` | P1 |
| `active` | `status === 'OPEN'`, line 911 | 18 of 18 active | P1 |
| `linear` | `ctType === 'LINEAR'`, line 912 | `true` on 18 of 18 | P1 |
| `contractSize` | `ctVal`, line 946 | equal to `ctVal` on 18 of 18 | P1 |
| `taker`, `maker` | `tFee`, `mFee`, lines 951 and 952 | `undefined` on 18 of 18, see [`fees.md`](./fees.md) section 8 | P1 |
| load | 888 markets, 18 of them active swaps, in 909 and 779 ms | | P1 |

The connector's filter keeps all 18, because each is `type` `swap`, `swap` true and `active` true, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203.
The connector then drops every one of them unless the registry sets `takerPpm`, see [`fees.md`](./fees.md) section 8.

### Size unit, pairs listed twice, and price scale

| contract | `ctVal` = CCXT `contractSize` |
|---|---:|
| `BTC_USDT_PERP` | 0.001 |
| `ETH_USDT_PERP`, `LTC_USDT_PERP`, `BCH_USDT_PERP` | 0.01 |
| `BNB_USDT_PERP`, `SOL_USDT_PERP`, `AVAX_USDT_PERP`, `LINK_USDT_PERP` | 0.1 |
| `SUI_USDT_PERP`, `APT_USDT_PERP`, `UNI_USDT_PERP`, `FIL_USDT_PERP` | 1 |
| `XRP_USDT_PERP`, `ADA_USDT_PERP` | 10 |
| `TRX_USDT_PERP`, `DOGE_USDT_PERP`, `1000SHIB_USDT_PERP` | 100 |
| `1000PEPE_USDT_PERP` | 1,000 |

Book sizes are contracts, and `ctVal` converts them into base units, see [`websocket.md`](./websocket.md) section 4.
The ticker's 24 hour quote volume divided by its contract volume and by the day's mid price gave 0.95 to 1.03 times `ctVal` on 18 of 18 contracts in the first run.
That check puts `1000PEPE_USDT_PERP` at 973.7 against a `ctVal` of 1,000, so its `ctVal` counts units of `1000PEPE`, the unit its price is quoted in.
That reading is an inference from volume, and it means CCXT's base `1000PEPE` with `contractSize` 1,000 is consistent.
No pair is listed twice.
The two 1000x contracts carry `1000` in their CCXT base, `1000PEPE` and `1000SHIB`, so they cluster only with a venue whose base is spelled the same way and priced per 1,000 as well, and they need no price scale entry in [`../../../server/src/engine/cluster/clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).

The 24 hour quote volume summed to 13.48 million USDT over the 18 contracts in the first run, 4.86 million of it on BTC and 3.93 million on ETH.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time over 60 polls, three runs |
|---|---|---|---|---|---|---|---|
| `GET /v3/market/indexPrice` | `iPx` | | | | | 726 and 727 bytes, 18 rows | median 111, 111, 112 ms, max 295, 206, 362 ms |
| `GET /v3/market/markPrice` | | `mPx` | | | | 725 to 730 bytes, 18 rows | median 112, 111, 111 ms, max 247, 398, 377 ms |
| `GET /v3/market/tickers` | `iPx`, not in R3's field list | `mPx` | | | | 5,106 bytes, 18 rows | median 113, 114, 111 ms, max 373, 395, 357 ms |
| `GET /v3/market/fundingRate?symbol=<id>` | | | `nFR` | `nFT` minus `fT` | `nFT` | 132 bytes, one contract | 18 calls per `main` run: median 113 ms in both, max 396 and 378 ms |

No call returns the funding rate for every contract at once.
`GET /v3/market/fundingRate` without `symbol` answers HTTP 200 with `{"code":24101,"msg":"Invalid symbol!","data":""}`, in both runs, and R4 marks `symbol` as required.
So a poller reads index and mark from bulk calls and makes one funding call per tracked contract, 18 today.
The ticker reply also carries both prices in one call, but its `iPx` is not documented.
The dedicated calls and the ticker, read in parallel, differed on 520, 570 and 484 of 1,080 contract readings, and each call's index moves about once a second, so a difference is the number moving between two reads.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `s` | string, `BTC_USDT_PERP` | none |
| `index` | `iPx` | decimal string | `Number()` |
| `mark` | `mPx` | decimal string, never 0 on the 18 rows of the first reply in each of three runs | `Number()` |
| `fundingRate` | `nFR` | decimal string, a fraction per interval: `"0.000037"` is 0.0037 % | `Number()` |
| `fundingIntervalHours` | `nFT` and `fT` | Unix ms, as strings over REST | `(Number(nFT) - Number(fT)) / 3_600_000`, which gave 8 on 18 of 18 |
| `nextFundingAt` | `nFT` | Unix ms as a string: `"1790150400000"` is 2026-09-23 08:00 UTC | `Number()` |

At 03:28 and 03:37 UTC all 18 contracts read `fT` `1790121600000`, 00:00 UTC, and `nFT` `1790150400000`, 08:00 UTC.
The interval is derived, since no call publishes it, and the 2026-04-30 formula lets it change within a day, see [`fees.md`](./fees.md) section 6.
Right after such a change the difference of `nFT` and `fT` can differ from the new interval, which is Not verified, because no change happened while probing.

## 4. Anchor semantics

### Index

The index is "derived from the spot prices of an underlying asset across several major exchanges", "weighted by trading volume", with weights "rebalanced quarterly", S12.
A source more than 3 % from the median of three or more sources is clamped to the median plus or minus 3 %, and a source with under 10 % valid data in the last 300 one-second points gets weight 0 until 90 % recovers, S12.
With no valid source the last index is kept and its timestamp advanced, S12.

`GET /v3/market/indexPriceComponents` without `symbol` returns every basket in one reply, 6,834 and 6,898 bytes in 232 and 199 ms, although R5 marks `symbol` as required.
Each row carries `px` and a list `cs` of `{e, w, sPx, cPx}`, where `cPx` is `w` times `sPx` and the `cPx` sum equals `px` to the digits shown.

| source | named in | weight above 0 in the first run | in the second run |
|---|---:|---:|---:|
| Binance | 18 | 18, from 0.400 to 0.798 | 18 |
| OKX | 18 | 18, from 0.103 to 0.305 | 18 |
| Poloniex | 18 | 18, from 0.055 to 0.292 | 17, `FIL_USDT_PERP` at 0 |
| KuCoin | 18 | 5 (`LINK`, `FIL`, `SUI`, `ADA`, `UNI`), each 0.100 | 5 |
| huobi | 18 | 6, the same five at 0.100 and `BNB` at 0.037 | 6 |
| HitBTC | 5 | 0 | 0 |
| Bittrex | 1 | 0 | 0 |

The index is a spot basket, and the Poloniex source is its spot book, not its perpetual.
So no basket is the venue's own perpetual, the shape that produced false rows on binance `ONE`, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
Poloniex's own spot weighs up to 0.292, on `BCH_USDT_PERP`, and its weight moves between reads, as FIL showed.
`bAsset` names the index, for instance `.PXBTUSDT` for BTC and `.PBNBUSDT` for BNB.

### Mark

"Mark price = Median price * (Price1, Price2, Futures price)", S12, with:

- "Price 1 = Index price * (1 + Funding basis rate)", where "Funding basis rate = Funding rate * (Time to next funding / Funding interval)".
- "Price 2 = Index price + Moving average (5-minute base)", the average of mid minus index sampled every 5 s over 5 minutes.
- "Futures price" is the contract's last trade.
- "In extreme market conditions or due to discrepancies in source prices", the mark is set to Price 2.

No clamp on the mark's premium to the index is published.
The third `anchor` run classified all 1,080 readings of the 18 marks against the ticker's `c`, its last trade price:

| mark equals | readings |
|---|---:|
| the last trade price exactly | 259 |
| within 100 ppm of the index, where Price 1 sits | 283 |
| neither, which is Price 2 | 538 |

So about a quarter of the readings are the contract's own last trade.
The last trade price changed only 1 to 3 times a minute on the four contracts watched, see the change table below, so such a mark can be a trade tens of seconds old.
At the start of the second run the mark stood from −987 ppm (`TRX`) to +630 ppm (`ADA`) off the index, and `BTC` read −484 ppm.

### Funding

The formula, the interval and the missing cap are in [`fees.md`](./fees.md) section 6.

| field | meaning | evidence |
|---|---|---|
| `fR` | "Current funding rate" in R4, and the rate of the settlement at `fT`, "the most recent funding rate settlement" in W4 | R4, W4. On the wire `fR` 0.000049 at `fT` 00:00 UTC equals the newest BTC history row |
| `nFR` | "The predicted funding rate is the current estimate of what the funding rate will be at the end of the current funding period" | R4 |
| `nFT` | "Forecasted funding time for the next period" | R4 |

So the upcoming settlement's rate is `nFR`, and the poller maps `nFR`, not `fR`.
`nFR` is an estimate that moves: BTC read 0.00003 at 03:18 UTC, 0.000037 at 03:28 and 03:37 UTC, and 0.000038 by 03:38 UTC.
17 of 18 contracts read exactly 0.0001 for both `fR` and `nFR` in both `main` runs.

`GET /v3/market/fundingRate/history` took `sT` and `eT` in milliseconds, although R6 says seconds.
With seconds it answered HTTP 200 with `{"code":400,"msg":"The sTime cannot be greater than 180 days ago","data":[]}`.
With milliseconds over three days it returned 9 BTC rows exactly 8 hours apart, the newest `0.000049` at `1790121600000` and the rest `0.0001`.
Without bounds it returned only the newest row, although R6 gives a default limit of 100.

### Rate across a settlement

No settlement fell inside the probes, and no probe waited for one.
What `fR`, `nFR` and `nFT` show in the seconds around a settlement was not captured.

### How often each number changed

Changes over 59 one-second intervals, three runs.

| contract | `iPx` | `mPx` | best bid | last trade `c` | `nFR` |
|---|---|---|---|---|---|
| `BTC_USDT_PERP` | 45, 47, 42 | 33, 17, 25 | 13, 39, 26 | 3, 2, 2 | 0, 1, 0 |
| `ETH_USDT_PERP` | 45, 45, 40 | 11, 25, 12 | 16, 39, 36 | 2, 3, 3 | 0, 0, 0 |
| `FIL_USDT_PERP` | 20, 35, 37 | 13, 24, 20 | 18, 29, 24 | 1, 1, 1 | 0, 0, 0 |
| `1000SHIB_USDT_PERP` | 26, 34, 32 | 12, 15, 19 | 6, 6, 5 | 1, 1, 1 | 0, 0, 0 |

The index republishes about once a second, and the socket's `index_price` and `mark_price` channels push once a second, see [`websocket.md`](./websocket.md) section 2.
No reply took more than 398 ms, far inside the reader's 2 s concern.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /v3/market/orderBook?symbol=<id>&limit=<n>` | R7 |
| depth | `limit` 5, 10, 20 and 100 returned exactly that many levels a side. 150 returned 101. 200, 1,000 and 7 answered `{"code":24104,"msg":"Invalid limit!","data":""}`. The default is 10 | R7, P1 both runs |
| size | 854 to 861 bytes at 20 levels, 3,684 to 3,781 at 100, in 102 to 132 ms | P1 |
| level order | bids descending, asks ascending, at every depth | P1 |
| fields | `bids`, `asks`, `ts`, and `s`, which is the price scale `"0.01"` and not the contract | P1 |
| sequence | none. The reply carries no update id, so it cannot be aligned with the `book_lv2` chain | P1 |
| aggregation | `scale=1` returned whole number prices | P1 |
| caching | six calls 150 ms apart repeated the same `ts` on 2 of 5 consecutive pairs in each run, and `ts` advanced by 193 to 795 ms when it moved | P1 |

The REST book is a fallback only, and the feed does not need it because `book_lv2` opens with a snapshot.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| public market data limit | 300 requests per second per IP across the market data endpoints, 20 per second for the candle endpoints | R1 |
| CCXT | `rateLimit` 5 ms with a cost of 2/3 per public v3 market call, the comment "300 calls / second" | `poloniex.js` lines 25 and 214 to 233 |
| limit status | 429 `TOO_MANY_REQUEST`, and 403 `ACCESS_DENY` | R8 |
| `Retry-After` | not seen, since no limit was reached | P1 |
| rate headers | only `ratelimit-filter: updated` on every reply, meaning Not publicly specified | P1 |
| unknown symbol | HTTP 200, `{"code":24101,"msg":"Invalid symbol!","data":""}`, on the book, funding, ticker and index calls | P1 |
| invalid limit | HTTP 200, `{"code":24104,"msg":"Invalid limit!","data":""}` | P1 |
| unknown path | HTTP 404, `{"code":404,"message":"Resources do not exist [404 NOT_FOUND \"No static resource v3/market/nope.\"]"}` | P1 |

A bad request is HTTP 200 with a nonzero `code` in the body, so a poller checks `code === 200` as well as the status.

## 7. Server time and clock offset

`GET /timestamp` returns `{"serverTime": <ms>}`, as CCXT's `fetchTime` reads it at `poloniex.js` lines 987 to 990.
Five round trips gave offsets of 3, 6, 138, 4 and 6 ms in the first run and 5, 3, 6, 3 and 6 ms in the second, a median of 6 and 5 ms.
`GET /v3/market/time` answered HTTP 404, and the Futures v3 documentation read names no time call of its own.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `GET https://api.poloniex.com/v3/market/indexPrice` and `GET https://api.poloniex.com/v3/market/markPrice` in parallel, and `GET https://api.poloniex.com/v3/market/fundingRate?symbol=<rawMarketId>` for each tracked contract in parallel | two documented bulk calls carry index and mark, and funding exists only per contract |
| interval | 1,000 ms, the default | median 111 ms and max 398 ms, and the index moves about once a second |
| budget | 20 requests per round, 20 per second | 7 % of the published 300 per second |
| alternative | `tickers` alone for index and mark, one call instead of two | its `iPx` is undocumented, so a silent removal would blank the index |
| alternative | funding every 10 s from a cache, index and mark every second | BTC's `nFR` changed once in 177 one-second intervals, the other three watched contracts never, and the socket pushes it once a minute, so 18 calls a second buy little. This needs a poller that keeps rows between rounds, which `AnchorPoller` does not do today |
| alternative | the `index_price`, `mark_price` and `funding_rate` socket channels | once a second and once a minute pushes, see [`websocket.md`](./websocket.md) section 2, and outside today's REST poller design |
| row mapping | section 3, key `s`, `fundingRate` from `nFR` | `fR` is the settled rate |
| skip | rows whose `status` is not `OPEN` in the catalog | documented states `PAUSED`, `CLOSED`, `CANCEL_ONLY`, `CANCEL_CLOSE_ONLY` |
| skip | a funding reply whose `code` is not 200 | errors arrive as HTTP 200 |
| rate limit pause | `rateLimitPauseMs` 5,000 | the window is per second, no `Retry-After` was seen, and five windows is a margin, not a measurement |
| deny list input | none from the basket survey | every basket is spot, and the largest Poloniex share was 0.292 |
| open question | the mark equals the contract's own last trade on about a quarter of readings, section 4 | a stale last trade can make a leg's premium read as fresh |

The poll moves about 4 KB of reply bodies a second, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| R1 | Futures REST API, introduction and rate limits | https://api-docs.poloniex.com/v3/futures/api/ | 2026-09-22 | Poloniex, global | host, 300 per second market data limit, sections 1 and 6 |
| R2 | Futures REST API, Get All Product Info | https://api-docs.poloniex.com/v3/futures/api/market/get-all-product-info | 2026-09-22 | Poloniex, global | catalog fields, status values, `alias`, section 2 |
| R3 | Futures REST API, Get Market Info | https://api-docs.poloniex.com/v3/futures/api/market/get-market-info | 2026-09-22 | Poloniex, global | ticker fields, `mPx` listed and `iPx` not, section 3 |
| R4 | Futures REST API, Get Current Funding Rate, Get Index Price and Get Mark Price | https://api-docs.poloniex.com/v3/futures/api/market/get-current-funding-rate | 2026-09-22 | Poloniex, global | `symbol` required for funding, optional for index and mark, field meanings, sections 3 and 4 |
| R5 | Futures REST API, Get Index Price components | https://api-docs.poloniex.com/v3/futures/api/market/get-index-price-components | 2026-09-22 | Poloniex, global | basket fields, section 4 |
| R6 | Futures REST API, Get The Historical Funding Rates | https://api-docs.poloniex.com/v3/futures/api/market/get-the-historical-funding-rates | 2026-09-22 | Poloniex, global | `sT`, `eT` and `limit`, section 4 |
| R7 | Futures REST API, Get Order Book | https://api-docs.poloniex.com/v3/futures/api/market/get-order-book | 2026-09-22 | Poloniex, global | limits and `scale`, section 5 |
| R8 | Futures error codes | https://api-docs.poloniex.com/v3/futures/error | 2026-09-22 | Poloniex, global | 403, 429, 24101, 24104, section 6 |
| W4 | Futures WebSocket API, Funding Rate | https://api-docs.poloniex.com/v3/futures/websocket/public/get-funding-rate | 2026-09-22 | Poloniex, global | `fT` is the most recent settlement, section 4 |
| S12 | Perpetual Futures' Index Price and Mark Price Explained, 2023-10-18 | https://www.poloniex.com/en-US/announcement/18359607883543 | 2026-09-22 | Poloniex Futures | index basket rules and mark formula, section 4 |
| C1 | CCXT 4.5.68 `poloniex.js` | `server/node_modules/ccxt/js/src/poloniex.js` | 2026-09-22 | CCXT | market mapping, rate limit costs, time call, sections 2, 6 and 7 |
| P1 | `rest-probe.mjs main`, runs at 03:27 and 03:37 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/poloniex/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 3, 5, 6 and 7 |
| P2 | `rest-probe.mjs baskets`, runs at 03:28 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/poloniex/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
| P3 | `rest-probe.mjs anchor`, runs at 03:28, 03:37 and 03:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/poloniex/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 3 and 4 |
