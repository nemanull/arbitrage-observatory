# x.me REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 06:36 to 07:08 UTC, which is the evening of 2026-09-22 in Seattle, from the development host near Seattle through its Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the public futures REST surface of x.me for its one perpetual family, USDT-M.
x.me publishes no API documentation that this research could find, so every call below was found in the website's own code or in the ChainUp `/fapi/v1` shape and then probed by [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs).
Two hosts answer: the open API host `futuresopenapi.x.me`, and the website's own API under `https://www.x.me/fe-co-api/`, which the futures page calls with `POST` and a JSON body.

## 1. Host and latency from this machine

| host | resolved | notes |
|---|---|---|
| `futuresopenapi.x.me` | `43.169.25.48` through the CNAME `futuresopenapi.x.me.eo.dnse5.com` | the open API, `/fapi/v1` |
| `www.x.me` | `43.169.25.48` through `www.x.me.eo.dnse5.com` | the website and its `fe-co-api`, `fe-ex-api` and `egw` calls |
| `futuresws.x.me`, `ws.x.me` | `43.169.25.48` | the sockets, see [`websocket.md`](./websocket.md) |
| `openapi.x.me` | `43.169.25.48` | the spot open API, `/sapi/v1` |

Every reply carried `server: TencentEdgeOne` and `eo-cache-status: MISS`, so the hosts sit behind Tencent Cloud EdgeOne and the replies are not cached at the edge.
`support.x.me` is a Zendesk help centre, CNAME `vooxhelp.zendesk.com`.

| call | first request, run 1 and run 2 | warm requests, run 1 | warm requests, run 2 |
|---|---|---|---|
| `GET /fapi/v1/time` | 961 and 491 ms | 9 reads: min 350, median 362, max 478 ms | 9 reads: min 147, median 154, max 349 ms |
| `POST /fe-co-api/common/public_market_info` | 454 and 467 ms | 9 reads: min 356, median 363, max 454 ms | 9 reads: min 357, median 362, max 386 ms |
| `GET /fapi/v1/contracts`, 120,820 bytes | | 498, 1,073 and 512 ms | 503, 1,516 and 480 ms |
| `POST /fe-co-api/common/public_info`, 250,252 bytes | | 332 ms | 383 ms |

Run 1 was at 06:48 UTC and run 2 at 07:05 UTC.
The round trip to the edge moved between about 150 and 350 ms from one run to the next.

Every access result here is what the Canadian VPN exit received.
No call was refused, challenged or geoblocked.

### What was checked for documentation

| check | result |
|---|---|
| `https://www.x.me/en_US/api`, `/api`, `/apidoc`, `/en_US/apiDoc` | 404 with the website's single page shell of 18,437 bytes |
| `https://openapi.x.me/` and `https://futuresopenapi.x.me/` | 200 with `{"code":"0","msg":"Succeed","data":null,"message":null,"succ":true}`, and 200 with error code -1002, section 6 |
| `open_api_url` in `POST https://www.x.me/fe-ex-api/common/public_info_v4` | `"www.chaindown.com/exchange-open-api"`, which did not answer within 8 s and 12 s, status 000 |
| the Zendesk search API for "API", "API documentation" and "apikey" | no article about the API, see [`fees.md`](./fees.md) S17 |
| GitHub repository search for `voox`, `voox api`, `x.me exchange api` and `xme openapi` | no x.me repository |
| the website bundles | a `/my/apiManagement` page for creating keys, and no documentation link |

So the platform is ChainUp by its shape: the `fe-co-api` and `fe-ex-api` web prefixes, the `futuresopenapi` host with the `/fapi/v1` calls, the `kline-api/ws` sockets, and the Chinese error text of section 6.

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.x.me/fapi/v1/contracts` returns a JSON array of every contract ever listed, with the keys `symbol`, `pricePrecision`, `side`, `maxMarketVolume`, `multiplier`, `minOrderVolume`, `maxMarketMoney`, `type`, `maxLimitVolume`, `maxValidOrder`, `multiplierCoin`, `minOrderMoney`, `maxLimitMoney`, `contractId` and `status`.

| count | value |
|---|---|
| listed | 343 |
| `status` 1, active | 266 |
| `status` 0, closed | 77, such as `E-XTZ-USDT`, `E-KAVA-USDT` and `E-OM-USDT` |
| `type` | `E` on all 343 |
| quote | USDT on all 266 active |
| `multiplier` on active contracts | 1 on 142, 0.01 on 58, 0.1 on 53, 0.001 on 6, 100 on 4, 10 on 3 |
| bases listed twice | none |

The website's `POST https://www.x.me/fe-co-api/common/public_info` returns `contractList` with exactly the 266 active contracts.
Its `id` equals `contractId`, its `multiplier` equals the open API's, and its `subSymbol`, the socket symbol, equals `e_` plus the lower case base plus `usdt` on 266 of 266.
It adds `capitalFrequency`, the funding interval in hours, `nextCapitalSettTime` in Unix ms, `maxLever`, `deliveryKind` `"0"`, `contractSide` 1 and `marginCoin` `USDT` on every contract.

### How a catalog would map it

CCXT 4.5.68 has no x.me class, see [`fees.md`](./fees.md) section 8, so the connector's `loadMarkets` at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68 cannot load this venue.
A catalog built from these two calls would set:

| `Market` field | source | note |
|---|---|---|
| `rawMarketId` | `symbol`, as in `E-BTC-USDT` | the REST anchor and book calls take this spelling, and the socket takes `subSymbol`, so the feed keeps a map between the two |
| `base` | `multiplierCoin` | equals the middle of `symbol` on all 266 |
| `quote` | `USDT` | |
| `linear` | true | USDT margined |
| `contractSize` | `multiplier` | the book size unit, see [`websocket.md`](./websocket.md) section 4 |
| active | `status` 1 | the website list holds only these |

### Pairs listed twice, price scale and names to screen

No base is listed twice.
`E-1000SATS-USDT`, `E-1000BONK-USDT` and `E-1MBABYDOGE-USDT` quote a bundle of 1,000 or 1,000,000 tokens in their name, so they need the same care as other venues' scaled names in [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 20 to 26.
At least 41 active contracts are equity, ETF, commodity or pre-IPO perpetuals, such as `E-OPENAI-USDT`, `E-QQQ-USDT`, `E-XAU-USDT` and `E-SAMSUNG-USDT`, listed in [`fees.md`](./fees.md) section 3, and a ticker that names a different thing on another venue needs a `DENIED_PAIRS` line at the same file, line 7.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/index?contractName=E-BTC-USDT` | `indexPrice` | `tagPrice` | `currentFundRate`, and `nextFundRate` | absent | absent | 98 bytes, one contract | 120 reads per run: min 145 and 145, median 199 and 223, p90 375 and 382, max 1,041 and 1,078 ms |
| `POST /fe-co-api/common/public_market_info` with `{"contractId":48}` | `indexPrice` | `tagPrice` | `currentFundRate`, and `nextFundRate` | absent | absent | 146 bytes, one contract | 120 reads per run: min 146 and 146, median 160 and 166, p90 364 and 366, max 478 and 1,517 ms |
| `POST /fe-co-api/common/public_info` | | | | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 250 KB, all 266 | 332 ms |
| socket `market_<sym>_ticker` | `index` | `mark` | `funds_rate` | absent | absent | one contract per channel, all 266 on one socket | a frame per channel every 1.2 to 1.8 s at the median and 4.5 s at worst, see [`websocket.md`](./websocket.md) section 5 |

No REST call returns index, mark and funding for every contract at once.
Whether the ticker's `mark` and `index` equal the REST `tagPrice` and `indexPrice` read at the same instant was Not verified, since no probe read both together.
`GET /fapi/v1/index` without `contractName` answers code -1121, and `/fapi/v1/tickers`, `/ticker_all`, `/premiumIndex` and `/fundingRate` answer code -1002, which is also the reply to a made up path such as `/fapi/v1/nope`, so none of them is public, whether or not a keyed version exists.
One round of `public_market_info` over the 266 active contracts, two requests at a time, took 26,335 ms and 26,691 ms in the rerun, and returned 266 rows with a mark above 0 both times, per call median 158 ms and max 981 and 893 ms.
A one second REST round would therefore take about 266 requests a second, against a limit x.me does not publish.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` of the catalog, or `contractId` for the website call | `E-BTC-USDT`, or `48` | map `contractId` to `symbol` from the catalog |
| `index` | `indexPrice`, or ticker `index` | JSON number, or decimal string on the socket | `Number()` |
| `mark` | `tagPrice`, or ticker `mark` | JSON number, or decimal string | `Number()` |
| `fundingRate` | `currentFundRate`, or ticker `funds_rate` | fraction per interval: `-0.00014551` is −0.014551 % | `Number()` |
| `fundingIntervalHours` | `capitalFrequency` | integer hours: 8 on 103 contracts and 4 on 163 | none |
| `nextFundingAt` | `nextCapitalSettTime` | Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 06:49 UTC all 266 contracts, 4 h and 8 h alike, read `nextCapitalSettTime` 1790150400000, 08:00 UTC.

## 4. Anchor semantics

### Index

The Index Price article, edited 2024-11-07, R3, says the index is a weighted average of "the latest transaction price of the standard currency pair of the mainstream exchange", sampled every second.
Its table gives BTCUSDT and ETHUSDT as OKX 33.3 %, HTX 33.3 % and Binance 33.3 %.
A source not updated within 40,000 ms whose price moved too far is set to weight 0, and a source more than 3 % from the median of all sources is clamped to the median ±3 %, R3.

The wire disagrees with the table.
The website's `POST /fe-co-api/common/index_price_weight_list` with `{"contractId":…}` returns the live basket:

| contract | basket, weight and share |
|---|---|
| `E-BTC-USDT` | `okex` 3, 27.3 %, and `binancefutures` 8, 72.7 % |
| `E-ETH-USDT` | `binance` 5, 50 %, `bybit` 2, 20 %, and `okex` 3, 30 % |
| `E-TRX-USDT` | `binance` 5, 50 %, `okex` 3, 30 %, and `bybit` 2, 20 % |
| `E-DOS-USDT` | `bybit` 2, 16.7 %, and `binancefutures` 10, 83.3 % |
| `E-OPENAI-USDT`, `E-QQQ-USDT`, `E-XAU-USDT` | `bybit` 2, 13.3 %, `okex` 3, 20 %, and `binancefutures` 10, 66.7 % |
| `E-KERNEL-USDT` | `binancefutures` 9, 81.8 %, `gate` 1, 9.1 %, and `mexc` 1, 9.1 % |

`binancefutures` names Binance's futures market, so these indexes lean mostly on another venue's perpetual, and on OPENAI, QQQ and XAU, which have no spot market on those venues, every source is presumably a perpetual.
Whether `okex`, `bybit`, `gate` and `mexc` mean spot or perpetual is Not publicly specified.
No basket holds x.me itself, so the self-index trap of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) is not present, but a mark that follows Binance's perp moves with Binance's basis.

### Mark

The Mark Price article, edited 2026-07-01, R4: "Mark Price= Median number (latest price, reasonable price, moving average price)".

- Latest price is the median of best bid, best ask and last trade.
- Reasonable price is index × (1 + previous funding rate × time to the next settlement / interval).
- Moving average price is index + the 5 minute moving average of the spread between the venue's median price and the index.

No clamp on the mark premium is published.
Over 60 samples per contract in each `anchor` run, `tagPrice / indexPrice − 1` ranged from −145 to 191 ppm on BTC, −131 to 207 on ETH, −116 to 175 on TRX and −890 to 1,782 on DOS.
In the first `round` run the largest premiums of the 266 were TRUMP at 881 ppm, KMNO at 831 and KERNEL at −688, and in the rerun MMT at −1,143, ATH at −981 and SOXS at −914.
A closed contract and an unknown `contractId` do not fail: section 6 shows the zeros and stale prices they return.

### Funding

The formula, the composite rate and the per contract caps are in [`fees.md`](./fees.md) section 6.
The published rate is the upcoming one, recomputed as the hour runs:

- `currentFundRate` equalled `nextFundRate` on 480 of 480 samples over two runs, so the two fields carry one number.
- BTC read −0.00012809 at 06:50 UTC and −0.00016646 at 07:07 UTC while its last settled rate, at 00:00 UTC, was −0.00022051.
- The rate changed once in 60 s on BTC, ETH and DOS, and not at all on TRX, in both runs.

### Settled history, and the rate across a settlement

`POST /fe-co-api/common/funding_rate_list` with `{"contractId":48,"page":1,"limit":6}` returns `historyList` rows with the keys `amount`, `ctime` and `contractName`, where `amount` is the settled rate and `ctime` the settlement in Unix ms.
Other body shapes, `{"contractId":48}`, `{"contractId":48,"pageNum":1,"pageSize":10}` and a time range, answered code 200002 "Please try again later".
BTC settled at 00:00, 08:00 and 16:00 UTC and DOS every 4 h from 00:00 UTC.
The settlement instant itself was not captured, so whether the published rate resets at settlement is Not verified.

### How often each number changed

60 polls a second apart, alternating the two calls, so each call was read 30 times per run.
Each cell gives run 1 at 06:49 UTC, then run 2 at 07:06 UTC.

| contract | index changes, open API | index changes, website | mark changes, open API | mark changes, website | index changes over all 60 | mark changes over all 60 |
|---|---|---|---|---|---|---|
| `E-BTC-USDT` | 12, 11 | 12, 11 | 8, 10 | 9, 11 | 15, 14 | 10, 13 |
| `E-ETH-USDT` | 20, 22 | 21, 21 | 15, 16 | 16, 16 | 31, 29 | 18, 19 |
| `E-TRX-USDT` | 16, 7 | 13, 12 | 13, 9 | 14, 5 | 18, 14 | 16, 9 |
| `E-DOS-USDT` | 6, 3 | 4, 3 | 4, 3 | 6, 3 | 6, 3 | 6, 3 |

Both calls return the same four fields, and their change counts are alike, so neither refreshes faster than the other.
R4 says the mark updates "typically every few seconds", which matches a mark that changed at most 19 times in 60 s.

## 5. REST book snapshot

| call | levels | order | notes |
|---|---|---|---|
| `GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=5` | 5 and 5 | bids descending, asks ascending | `"time": null` |
| same with `limit` 30, 50, 100, 200 or 1000, or no `limit` | 30 and 30 | same | the cap is 30 per side |
| same with `limit=0` | 0 and 0 | | `{"asks":[],"bids":[],"time":null}` |
| `POST /fe-co-api/common/depth_map` with `{"contractId":48}` | 500 and 500 | | `buys`, `middle` and `asks` rows of `[price, size, cumulative size]` on a 0.1 grid, 23,474 bytes |

Two depth reads back to back returned identical text in the first run and different text in the rerun, which fits a book refreshed every 500 ms like the socket.
No `cache-control` header was sent.
Sizes are contracts and matched the socket at 54 of 57 shared prices, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No rate limit is published, and no reply carried a rate limit header.
The probes peaked at about eight requests a second, in the `round` run, and no request was refused.

Every reply below had HTTP status 200, with the error in the body.

| request | body |
|---|---|
| `GET /fapi/v1/index?contractName=E-NOPE-USDT`, or no `contractName` | `{"code":"-1121","msg":"无效的合约","data":null}`, "invalid contract" |
| `GET /fapi/v1/depth?contractName=E-NOPE-USDT&limit=5` | the same -1121 |
| `GET /fapi/v1/index?contractName=e-btc-usdt` | served, lower case is accepted |
| `GET /fapi/v1/index?contractName=E-XTZ-USDT`, a closed contract | `{"currentFundRate":0,"indexPrice":0.341,"tagPrice":0.341,"nextFundRate":0}` |
| `GET /fapi/v1/depth?contractName=E-XTZ-USDT&limit=5`, closed | a full stale book |
| `GET /fapi/v1/nope`, `/tickers` | `{"code":"-1002","data":null,"msg":"您无权执行此请求。请求需要发送API Key，我们建议在所有的请求头附加X-CH-APIKEY","succ":false}`, "not authorized, send an API key in `X-CH-APIKEY`" |
| `POST public_market_info` with `{"contractId":999999}` | `{"code":"0","msg":"Success","data":{"currentFundRate":0,"indexPrice":0,"tagPrice":0,"nextFundRate":0},"succ":true}` |
| `POST public_market_info` with `{"contractId":98}`, closed | code 0 with `indexPrice` and `tagPrice` 0.341 and rates 0 |
| `POST public_market_info` with `{}` | `{"code":"200004","msg":"Invalid parameters","data":null,"succ":false}` |

An unknown `contractId` succeeds with a mark of 0, which the engine reads as "no mark" and refuses at open, so a stale id fails safe.
A closed contract succeeds with a frozen price and a rate of 0, which does not fail safe, so a poller has to drop closed contracts from the catalog first.

## 7. Server time and clock offset

`GET /fapi/v1/time` returns `{"timezone":"GMT+08:00","serverTime":1790146298305}`.

| run | server time minus the local midpoint | round trip |
|---|---|---|
| 06:51 UTC | min 103, median 105, max 352 ms | min 351, median 362, max 1,005 ms |
| 07:07 UTC | min 0, median 4, max 67 ms | min 150, median 155, max 299 ms |

This host's clock was NTP synchronised.
The rerun, with a round trip under half as long, put the venue's clock a median 4 ms from this host's, inside the ±75 ms that a 150 ms round trip allows, so the first run's 105 ms was most likely an asymmetric path and not a clock error.
`GET https://openapi.x.me/sapi/v1/time` has the same shape.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

No REST call fits the engine's `AnchorPoller`, which reads one bulk reply per round at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 103.
Two shapes would work, and each is a named change.

| option | shape | cost |
|---|---|---|
| socket anchor, recommended | subscribe `market_<sym>_ticker` for every tracked contract, as in [`websocket.md`](./websocket.md) section 2, stamp each frame on arrival, and fill `index`, `mark` and `fundingRate` from it. Read `capitalFrequency` and `nextCapitalSettTime` from `public_info` once a minute | a socket source for anchors, which the engine does not have today. A channel's frames were up to 4.5 s apart, inside the reader's 10 s age limit but most of its 5 s skew limit, at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 4 and 5 |
| REST round | one `public_market_info` per tracked contract per round | 266 calls, 26 s at two in flight, so a one second cadence needs about 266 requests a second with no published limit |

Either way:

- Skip contracts with `status` 0, since they return a frozen price and a rate of 0.
- Treat `currentFundRate` as the upcoming rate and ignore `nextFundRate`, which repeats it.
- Take the interval and next settlement from `public_info`, since neither the index call nor the ticker carries them.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| R1 | x.me open API, futures | https://futuresopenapi.x.me/fapi/v1/ | 2026-09-23 | x.me | `contracts`, `index`, `depth`, `ticker`, `time`, sections 2 to 7 |
| R2 | x.me website API, futures, and the futures page bundle `chunk-common~4eda4e2e.9c0f8842.js` that names its calls | https://www.x.me/fe-co-api/common/ and https://static.xmestatic.com/exchange-web/js/chunk-common~4eda4e2e.9c0f8842.js | 2026-09-23 | x.me | `public_info`, `public_market_info`, `index_price_weight_list`, `funding_rate_list`, `depth_map`, sections 2 to 6 |
| R3 | Index Price, edited 2024-11-07 | https://support.x.me/hc/en-us/articles/10565588351759-Index-Price | 2026-09-22 | x.me, global | index formula, the documented basket, exception rules, section 4 |
| R4 | Mark Price, edited 2026-07-01 | https://support.x.me/hc/en-us/articles/10565465644815-Mark-Price | 2026-09-22 | x.me, global | mark formula and update rate, section 4 |
| R5 | Funding Rate, edited 2024-08-29 | https://support.x.me/hc/en-us/articles/10565408952079-Funding-Rate | 2026-09-22 | x.me, global | funding formula, see [`fees.md`](./fees.md) section 6 |
| R6 | `POST https://www.x.me/fe-ex-api/common/public_info_v4` | https://www.x.me/fe-ex-api/common/public_info_v4 | 2026-09-23 06:36 UTC | x.me | `open_api_url`, `limitCountryList`, section 1 |
| P1 | `rest-probe.mjs latency` at 06:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | section 1 |
| P2 | `rest-probe.mjs catalog` at 06:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | section 2 |
| P3 | `rest-probe.mjs anchor` at 06:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 3 and 4 |
| P4 | `rest-probe.mjs round` at 06:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 3 and 4 |
| P5 | `rest-probe.mjs depth`, `errors` and `time` at 06:51 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 5 to 7 |
| P6 | `dig` of the hosts at 06:36 UTC, `curl` of the guessed calls and documentation paths at 06:36 to 06:48 UTC, and of `index_price_weight_list` for OPENAI, QQQ, XAU and KERNEL at 06:53 UTC | | 2026-09-23 | this host, Canadian VPN exit | sections 1, 3 and 4 |
| P7 | second pass, every mode rerun once from 07:05 to 07:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/x-me/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the second reading of every number in sections 1 to 7 |
