# XT.COM REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:16 to 04:01 UTC, from the development host near Seattle.

This profile covers the public futures REST API of XT.COM (CCXT id `xt`) for both perpetual families, with the catalog and the anchor calls in detail.
Every number was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) unless it names another source, and the runs are listed in section 9.
All calls were public and unauthenticated, at most three a second.

## 1. Host and latency from this machine

| host | family | resolved | cold request | warm, ten requests | source |
|---|---|---|---|---|---|
| `fapi.xt.com` | USDT-M | CloudFront `d14jcwchm6jcic.cloudfront.net`, four IPv4 `99.86.101.x` and eight IPv6, POP `SEA900-P13` | 447 and 422 ms | min 184 and 182, median 343 and 347, max 368 and 360 ms | P1 |
| `dapi.xt.com` | coin-M | CloudFront `dfq9tzqco7rf8.cloudfront.net`, four IPv4 `52.85.129.x` and eight IPv6, POP `SEA900-P10` | 389 and 407 ms | min 174 and 179, median 345 and 337, max 359 and 371 ms | P1 |

Every reply carried `x-cache: Miss from cloudfront`, so every call reaches the origin and none is served from the edge cache.
No call from this host was refused, and no geoblock was met on any host.
The documentation warns: "It is not recommended to access XT APIs via proxy due to high latency and poor stability", S1.

## 2. Catalog

### The instruments call

CCXT's `fetchSwapAndFutureMarkets` calls `GET https://fapi.xt.com/future/market/v1/public/symbol/list` and the same path on `dapi.xt.com`, at `server/node_modules/ccxt/js/src/xt.js` line 1059.
The USDT-M reply is 2.55 MB with 1,148 rows and took 747 to 1,210 ms over four runs, and the coin-M reply is 470 KB with 212 rows and took 260 to 571 ms, P2.
`GET /future/market/v3/public/symbol/list` returns the same 1,148 rows in 95 KB, S29, and CCXT does not use it.

Every row has `state` 0.
Three switches decide what a row is: `tradeSwitch`, `openSwitch` and `isOpenApi`.

| family | product | `tradeSwitch` | `isOpenApi` | rows |
|---|---|---|---|---:|
| USDT-M | perpetual | true | true | 691 |
| USDT-M | perpetual | true | false | 37 |
| USDT-M | perpetual | false | true | 65 |
| USDT-M | perpetual | false | false | 303 |
| USDT-M | futures | true | true | 4 |
| USDT-M | futures | false | true or false | 48 |
| coin-M | perpetual | true | true | 30 |
| coin-M | perpetual | false | true | 3 |
| coin-M | perpetual | false | false | 45 |
| coin-M | futures | true | true or false | 7 |
| coin-M | futures | false | true or false | 127 |

The 37 perpetuals that trade but are closed to the Open API include `dia_usdt`, `soph_usdt`, `nvdax_usdt`, `pltr_usdt` and `openai_usdt`.
The 65 that are open to the API but do not trade are delisted contracts such as `ftt_usdt`, `matic_usdt` and `ftm_usdt`.
All quote currencies are `usdt` on `fapi` and the settlement coin is the base on `dapi`.

### How CCXT 4.5.68 maps it

| CCXT field | source field | note |
|---|---|---|
| `id` | `symbol`, lower case, `btc_usdt` | the same string on the socket, in `cg/contracts` `symbol` and in `q/mark-price` and `q/index-price` `s`, see [`websocket.md`](./websocket.md) section 3 |
| `active` | `isOpenApi` only, line 1330 | `tradeSwitch` is ignored, so 68 active swaps do not trade: 65 USDT-M and 3 coin-M |
| `linear` | `underlyingType` `U_BASED`, lines 1294 to 1300 | `COIN_BASED` gives `inverse` |
| `contractSize` | `contractSize`, line 1358 | a string such as `"0.0001"` on the wire |
| `swap` | `productType` `perpetual`, lines 1311 to 1318 | `futures` rows become `future` |
| `taker`, `maker` | `takerFee`, `makerFee`, lines 1356 and 1357 | see [`fees.md`](./fees.md) section 8 |

`loadMarkets` took 2,440 to 3,033 ms over four runs and returned 2,545 markets, of which 1,174 swaps, 186 futures and 1,185 spot, P2.
The engine's filter of active swaps keeps 789: 756 USDT-M and 33 coin-M.

### Size unit, pairs listed twice, and price scale

The size unit on the book and in the 24 h volume is contracts, and one contract is `contractSize` coins on the linear family, see [`websocket.md`](./websocket.md) section 4.
The engine catalog's contract sizes were 1 on 242 markets, 10 on 218, 0.01 on 111, 0.1 on 101, 100 on 79, 0.001 on 17, 1000 on 14, 0.0001 on 4, 10000 on 2 and 0.5 on 1.
Coin-M contracts are sized in US dollars, `contractSize` 100 on `btc_usd`, 10 on 27 of the 30 tradable coin-M perpetuals and 1 on two, so the engine's size multiplier would read dollars as coins there.

32 bases are listed in both families, among them BTC, ETH, SOL, XT, LTC and BCH, so the venue offers two contracts on one pair.
A `marketFilter` that keeps `linear` USDT contracts picks one, see section 8.

24 active linear bases start with a digit, P2.
Most carry a `1000`, `1m` or `1000000` prefix, such as `1000pepe_usdt`, `1000000mog_usdt`, `1mbabydoge_usdt` and `1000cheems_usdt`, which names a multiple of the token and needs a price scale in the clusters wherever another venue lists the plain token.
`1inch_usdt`, `2z_usdt` and `4_usdt` are token names that start with a digit.
Six ids are Chinese words, such as `龙虾_usdt` and `币安人生_usdt`, and they route on the socket unchanged.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /future/market/v1/public/q/index-price` | `p` | | | | | 40 KB, 729 rows | 60 polls, three runs: median 190 to 194 ms, p90 353 to 362, max 368 to 404 |
| `GET /future/market/v1/public/q/mark-price` | | `p` | | | | 36 KB, 731 rows | median 187 to 193 ms, p90 347 to 362, max 362 to 392 |
| `GET /future/market/v1/public/cg/contracts` | `index_price`, a slower copy | none | `funding_rate` | `collection_internal`, hours | `next_funding_rate_timestamp`, Unix ms | 454 KB, 732 rows | median 392 to 553 ms, p90 726 to 742, max 778 to 1,090, and 1 poll over 1 s in two of three runs |
| `GET /future/market/v1/public/q/agg-tickers` | `i` | `m` | | | | 240 KB, 1,202 rows including delisted and dated contracts | 665 to 690 ms, one read per run |
| `GET /future/market/v1/public/q/funding-rate?symbol=` | | | `fundingRate` | `collectionInternal`, hours | `nextCollectionTime`, Unix ms | one contract, a missing `symbol` answers `invalid_symbol` | 180 to 413 ms |

The same paths on `dapi.xt.com` return the coin-M rows: 36 in `cg/contracts`, 37 in `q/mark-price` and 37 in `q/index-price`, P3.
The `cg/contracts` path is the CoinGecko contracts feed, and the reference page names it `GET /v1/public/cg/contracts`, S30.
CCXT reports `fetchFundingRates` as false at `xt.js` line 76, and the documentation lists no bulk funding call, so `cg/contracts` is the only bulk source of funding, interval and next settlement.
No single call carries all five `AnchorRow` fields, so a poller reads three.

Coverage of the 691 tradable Open API USDT-M perpetuals on every anchor run: `cg/contracts` 691, `q/mark-price` 690, missing `moonshot_usdt`, and `q/index-price` 689, missing `moonshot_usdt` and `anthropic_usdt`, P3.
`cg/contracts` also lists the 37 contracts closed to the Open API and the four trading dated futures, and it leaves out every contract whose `tradeSwitch` is false.

### Row mapping

| `AnchorRow` column | call and field | unit on the wire | conversion |
|---|---|---|---|
| key | `s` of `q/index-price` and `q/mark-price`, `symbol` of `cg/contracts` | `btc_usdt` | none |
| `index` | `q/index-price` `p` | decimal string, `"86551.6972596"` | `Number()` |
| `mark` | `q/mark-price` `p` | decimal string, never 0 on 731 rows | `Number()` |
| `fundingRate` | `cg/contracts` `funding_rate` | decimal string, a fraction per interval, `"0.00003728"` | `Number()` |
| `fundingIntervalHours` | `cg/contracts` `collection_internal` | integer hours: 1, 4 or 8, and `null` on dated futures and `moonshot_usdt` | none |
| `nextFundingAt` | `cg/contracts` `next_funding_rate_timestamp` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:18 UTC 436 contracts read 04:00 UTC next and 291 read 08:00 UTC, which matches 435 contracts on 4 h, `lsk_usdt` on 1 h and 291 on 8 h, P3.
`next_funding_rate` equalled `funding_rate` on 732 of 732 rows in every run, so it adds nothing.
The funding history call reports its interval in seconds, `collectionInternal` 28800 and 14400, while the current rate call and `cg/contracts` report hours, and the documentation says the same, S31.

### Why the index comes from `q/index-price`

`cg/contracts` `index_price` equalled `q/index-price` `p` on 234, 253, 249 and 278 of 689 contracts read seconds apart, and differed by a median of 21 to 50 ppm, a p90 of 363 to 548 ppm and a maximum of 3,828 to 6,064 ppm, P3.
Over 60 one second polls the BTC index in `q/index-price` changed on 44 to 58 polls, and in `cg/contracts` on 28 to 30, P4.
So `cg/contracts` republishes its index about every 2 s, and the index call is the fresher source.
`agg-tickers` carries both the index and the mark, and its `m` equalled the mark call on 597 to 634 of 689 contracts and its `i` the index call on 399 to 578, while it is three times the size of the two calls together.

## 4. Anchor semantics

### Index

"The index price is calculated by aggregating the trading prices of multiple top-tier spot exchanges, weighted by each exchange's trading volume", with `Weight of Exchange = 24-hour trading volume of the asset on that exchange ÷ Total 24-hour trading volume across all included exchanges`, S6.
The worked example in S6 puts XT's own BTC/USDT spot market in the basket at 20 %, so XT's spot book is a constituent.
No constituent list is public: `GET /future/market/v1/public/q/index-price/list?symbol=btc_usdt` returned a one second history of `btc_index` in a curl read at 03:34 UTC, and no other documented public call names exchanges or weights.
Index values carry a `t` on the index call, and the history call stamps whole seconds.

Stock, currency and commodity perpetuals are about a third of the tradable list.
Of the 691 contracts, 217 sit in the `TradFi` plate, 161 in `Tokenized Stocks`, 32 in `FOREX`, 8 in `Commodities` and 7 in `INDEX` of `GET /future/market/v1/public/plate/list`, P3.
How their index is sourced is Not publicly specified, since the help center formula is written for spot exchanges.
`nflx_usdt` read mark 72.71 against index 723.28 at 03:57 UTC, P3, and 72.42 against 722.80 in a curl read of `agg-tickers` at 03:36, a factor of ten, so its index is on a pre-split scale.
At 03:47 UTC one contract's mark and index were 309 s old on arrival, and a curl read at 03:48 named it `babaon_usdt` at 352 s.

### Mark

The documented formula is `Marker Price = Median * (Price 1, Price 2, Contract Price)`, read as the median of the three, with `Price 1 = Price Index * (1 + Margin *(Time to next Margin Call (in hours)/Margin Call Cycle))` and `Price 2` built from a 30 minute moving average of `(Bid1 + Ask1) / 2 − Price Index`, as the help center writes them, S5.
S5 adds that when `Abs(index price − marker price) / index price > 1%` the mark is taken from Price 2, and that the last traded price replaces the mark when the index is unreliable.
Pre-market contracts compute the mark from their own fills, the average of the last 10 s of trades, S11.

On the wire, from one `agg-tickers` reply at 03:57 UTC, P3:

| measure | value |
|---|---|
| mark equal to the contract's last trade | 268 of 691 contracts, and 249 in the 03:36 curl read |
| mark inside the contract's own bid and ask | 494 of 691 |
| abs(mark ÷ index − 1) | median 735 ppm, p90 2,895, p99 6,736 |
| contracts beyond 1 % | `one_usdt` −13,178 ppm, `1000000mog_usdt` +17,769, `twlo_usdt` −10,657, `nflx_usdt` −899,472 |

So the published mark is not held within 1 % of the index, and on about a third of contracts it is the leg's own last trade.
A mark that equals the leg's last trade tracks the leg itself, much like the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
The index is the independent reference on XT, and the mark premium over it is the number to read with care.

### Funding

The formula, averaging and clamp are in [`fees.md`](./fees.md) section 6.
The published `funding_rate` is the estimate for the next settlement and moves during the interval.
Across all 691 contracts and 59 poll intervals it changed 754, 894 and 1,431 times in three one minute runs, so one to two times a minute per contract on average, and `era_usdt` changed 6 times in one minute, P4.
The settled history differs from the estimate: `btc_usdt` settled 0.000031 at 2026-09-23 00:00 UTC while the estimate for 08:00 UTC read 0.00003728 to 0.00004304 during the probes, P3.
The settlement instant itself was not captured, so whether `nextFundingAt` and the rate roll at the instant or later is Not verified.

### How often each number changed

60 one second polls, three runs at 03:18, 03:35 and 03:48 UTC, P4.

| contract | index call | mark call | `cg` index | `cg` funding | mark `t` |
|---|---|---|---|---|---|
| `btc_usdt` | 44 to 58 of 59 | 23 to 36 | 28 to 30 | 1 or 2 | 43 to 59 |
| `eth_usdt` | 43 to 57 | 32 to 41 | 28 to 30 | 0 or 1 | 47 to 59 |
| `bat_usdt` | 6 to 9 | 0 to 3 | 6 to 8 | 0 | 59 |
| `alpine_usdt` | 9 or 10 | 0 or 1 | 6 to 8 | 0 | 48 to 59 |
| all 691, per contract per poll | 26 to 29 % | 12 to 14 % | 20 to 21 % | 2 to 4 % | |

The mark call's `t` advanced on nearly every poll while its price stood still on quiet contracts, so `t` is a publish time, not a price change time.
Arrival minus `t` on the mark and index calls had a per poll median of 579 to 1,455 ms over the second and third runs, P4.
Beside the socket, the REST reply carried a given `t` 28 to 334 ms after the `mark_price` frame with that `t`, W6.

## 5. REST book snapshot

`GET /future/market/v1/public/q/depth?symbol=btc_usdt&level=<n>` answered with `{t, s, u, b, a}`, P5.

| `level` | bids and asks returned | reply | time |
|---|---|---|---|
| 5 | 5 and 5 | 313 bytes | 497 and 515 ms, cold |
| 20 | 20 and 20 | 874 bytes | 192 and 342 ms |
| 50 | 50 and 50 | 2.0 KB | 178 and 347 ms |
| 100 | 100 and 100 | 3.9 KB | 336 and 356 ms |
| 500 | 500 and 500 | 18.9 KB | 189 and 363 ms |
| 1000 | 1,000 and 1,000 | 38 KB | 185 and 368 ms |
| 7 | served, not refused | | |
| absent | `invalid_level` | | |

The documentation says `level` runs from 1 to 50, S32, and the order book guide fetches `level=500`, so the served range is wider than the reference page says.
Bids come descending and asks ascending at every depth.
`u` is the same update sequence as the socket's deltas, and `t` was 86 to 122 ms old on arrival.
Two reads about 340 ms apart returned different `u` in both runs, so the reply is not cached.
CCXT asks for `Math.min(limit, 50)` levels at `xt.js` line 1560 and 50 when no limit is given at line 1563.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented limit | "Other endpoints: Up to 10 requests per second per user, and 1000 requests per minute per IP. If the frequency limit is exceeded, the account will be locked for 10 minutes." | S1 |
| per call, documented | `q/depth` 10/s/ip, `q/funding-rate` 1/s/ip, and "None" on the bulk calls | S32, S31 |
| headers on `q/depth` | `x-ratelimit-burst-capacity: 10`, `x-ratelimit-replenish-rate: 10`, `x-ratelimit-remaining: 9` | P5 |
| headers on `q/funding-rate` | burst and replenish 1000, which disagrees with the documented 1/s/ip | P3 |
| headers on the bulk calls | none | P3 |
| limit status | the error table lists `429 TOO_MANY_REQUESTS` | S33 |
| `Retry-After` | not seen, since no limit was reached | |
| application errors | HTTP 200 with `{"returnCode":1,"msgInfo":"failure","error":{"code":"invalid_symbol","msg":"invalid symbol","args":[]},"result":null}` | P6 |
| unknown path | HTTP 404, `{"timestamp":"2026-09-23T03:29:59.459+00:00","status":404,"error":"Not Found","path":"/v1/public/q/nope"}` | P6 |
| a coin-M symbol on the wrong host | `btc_usdt` on `dapi` answers `invalid_symbol` | P6 |
| a delisted contract | `ftt_usdt` still answers the funding and mark calls, and its mark `t` is 1737702036066, 2025-01-24 | P6 |

The engine's poller treats a limit by status code, so a limit that arrives as HTTP 200 with `returnCode` 1 would read as an empty round, which was not observed on the bulk calls.

## 7. Server time and clock offset

`GET /future/market/v1/public/time` returns `{"returnCode":0,"msgInfo":"success","error":null,"result":1790133452735}`, Unix ms.
Against the midpoint of each request, the server clock read 80 and 89 ms ahead on `fapi` and 84 and 81 ms ahead on `dapi`, median of eleven reads each, with single reads from −1 to 121 ms, P1.
With round trips near 340 ms the offset is known only to about ±170 ms, so the clocks agree within that.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| catalog filter | `marketFilter: (m) => m.linear === true && m.settle === 'USDT' && m.info.tradeSwitch === true` | CCXT marks 68 non-trading contracts active, and coin-M sizes are dollars and duplicate 32 bases |
| URLs every round | `https://fapi.xt.com/future/market/v1/public/q/index-price` and `https://fapi.xt.com/future/market/v1/public/q/mark-price`, in parallel | 76 KB together, median about 190 ms each, and the index moves on most seconds |
| funding URL | `https://fapi.xt.com/future/market/v1/public/cg/contracts`, read every round or cached for up to 10 s | the only bulk source of rate, interval and next settlement, 454 KB, and its rate moves one to two times a minute |
| interval | 1,000 ms, the default | three calls a second is 180 a minute, under the 1,000 a minute per IP |
| row mapping | section 3 | |
| skip | contracts missing from either the index or the mark reply, `moonshot_usdt` and `anthropic_usdt` on 2026-09-23 | no anchor to read |
| skip | rows whose `t` is more than 5 s older than arrival | the engine stamps on arrival, and `babaon_usdt` sat 352 s old |
| skip | pre-market contracts, `inPreMarket` true in the symbol list | the mark is the contract's own fills and there is no index |
| deny list input | `nflx_usdt`, whose index is ten times its price, and `one_usdt`, whose mark sat 1.3 % from its index | section 4, and ONE is already in `DENIED_PAIRS` |
| deny list input | the 217 `TradFi` contracts need a check against other venues' tickers before they cluster | a stock ticker can name a crypto token elsewhere |
| rate limit pause | `rateLimitPauseMs` 60,000 | no `Retry-After` is documented, and the documented penalty is a ten minute account lock whose effect on public calls is Not verified |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | XT Futures API, Basic Information of the Interface | https://doc.xt.com/docs/futures/Access%20Description/BasicInformationOfTheInterface | 2026-09-22 | XT.COM, global | hosts, proxy warning, rate limits, sections 1 and 6 |
| S5 | Mark Price | https://xtsupport.zendesk.com/hc/en-us/articles/7244864441625 | 2026-09-22 | XT.COM, global | mark formula and clamp, section 4 |
| S6 | Index Price Calculation | https://xtsupport.zendesk.com/hc/en-us/articles/50982930813209 | 2026-09-22 | XT.COM, global | index formula and XT in the basket, section 4 |
| S11 | Pre-Market Perpetual Contracts Product Rules | https://xtsupport.zendesk.com/hc/en-us/articles/58170113162137 | 2026-09-22 | XT.COM, global | pre-market mark, section 4 |
| S13 | CCXT 4.5.68 `xt.js` | `server/node_modules/ccxt/js/src/xt.js` | 2026-09-22 | CCXT | catalog calls and mapping, depth limit, sections 2, 3 and 5 |
| S29 | XT Futures, Get Configuration Information for Listed And Tradeable Symbols | https://doc.xt.com/docs/futures/MarketData/get-configuration-information-for-listed-and-tradeable-symbols | 2026-09-22 | XT.COM, global | the v3 symbol list, section 2 |
| S30 | XT contract API reference, `GET /v1/public/cg/contracts` | https://doc.xt.com/api/contract/get-contracts-using-get | 2026-09-22 | XT.COM, global | the bulk funding call, section 3 |
| S31 | XT Futures, Get Funding Rate Information and Get Funding Rate Records | https://doc.xt.com/docs/futures/MarketData/get-funding-rate-information | 2026-09-22 | XT.COM, global | per contract funding, interval units, 1/s/ip, sections 3 and 6 |
| S32 | XT Futures, Get Depth Data of Trading Pairs | https://doc.xt.com/docs/futures/MarketData/get-depth-data-of-trading-pairs | 2026-09-22 | XT.COM, global | depth levels and 10/s/ip, sections 5 and 6 |
| S33 | XT Futures, Error Code | https://doc.xt.com/docs/futures/Access%20Description/ErrorCode | 2026-09-22 | XT.COM, global | HTTP status table, section 6 |
| P1 | `rest-probe.mjs host` at 03:17 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | section 1 and 7 |
| P2 | `rest-probe.mjs catalog` at 03:17, 03:34, 03:47 and 04:00 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | section 2 |
| P3 | `rest-probe.mjs anchor` at 03:18, 03:34, 03:47 and 03:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 6 |
| P4 | `rest-probe.mjs poll` at 03:18, 03:35 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 4 |
| P5 | `rest-probe.mjs book` at 03:29 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 5 and 6 |
| P6 | `rest-probe.mjs errors` at 03:29 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
| W6 | `ws-probe.mjs lag` at 03:28 and 03:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | REST against the socket, section 4 |
