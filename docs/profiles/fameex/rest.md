# FameEX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:14 to 04:52 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures REST API of FameEX for its one perpetual family, USDT-M linear perpetuals.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs), from a one-off `curl` named in the ledger, or from the source it cites.
The documented API is S1, and its host names come from S2.
Two calls used below are not in S1: `GET /v1/inner/contract_config`, named by an unmerged CCXT pull request, S12, and `GET /fapi/v1/fundingRate`.
Both answered without credentials, and both are marked undocumented wherever they appear.

## 1. Host and latency from this machine

| host | resolved | cold | warm |
|---|---|---|---|
| `futuresopenapi.fameex.com` | CNAME `vpx4j8k.ng.impervadns.net`, one address, 45.60.107.210 | `/fapi/v1/time` 291 and 324 ms | 230 to 462 ms over ten calls in two runs |
| `futuresopenapi.fameex.net`, the documented backup | the same CNAME and address | not timed | |
| `openapi.fameex.com`, spot | the same CNAME and address | `/sapi/v1/symbols` 267 to 306 ms | |

Every FameEX API host sits behind Imperva, `x-cdn: Imperva`, P5.
Nothing refused this host, whose exit geolocates to Canada, a region the Terms exclude, see [`fees.md`](./fees.md) section 1.
Every call answered 200, including the errors, section 6.

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.fameex.com/fapi/v1/contracts`, documented in S1, returned 246 rows and 86,093 bytes in 721 and 679 ms, P1.

| field | values on 2026-09-23 UTC |
|---|---|
| `status` | 1 on 213, 0 on 33. S1: 0 is "Not tradable", 1 is "Tradable" |
| `type` | `E` on all 246. S1: E is perpetual, S is simulated, others are hybrid |
| `side` | 1 on all 246. S1: 0 is inverse, 1 is linear |
| quote | `USDT` on all 246 |
| `multiplier` | contract size, from 0.001 to 100,000, 1 on 66 active contracts |
| `multiplierCoin` | the base on 207 active contracts and `USDT` on 6 |
| `contractId` | integer, not in the documented response |

So the only perpetual family is USDT-M linear, with 213 active contracts.
The 213 include equity, commodity and index names such as `E-AAPL-USDT`, `E-NVDA-USDT`, `E-XAU-USDT`, `E-NATGAS-USDT`, `E-KUAISHOU-USDT` and `E-HK0700-USDT`, and the catalog has no flag that marks them.

The undocumented `GET https://futuresopenapi.fameex.com/v1/inner/contract_config` returned 213 rows and 141,561 bytes in 1,245 to 1,682 ms, P3 and P6.
Its rows are exactly the 213 active contracts, with the same `multiplier` on all of them, P6, and it adds `base`, `quote`, `marginCoin`, `capitalFrequency`, `capitalStartTime`, `capitalPremiumMin`, `capitalPremiumMax`, `settlementFrequency`, `maxLever` and `priceRange`.
`base` equals `multiplierCoin` except on the six contracts whose `multiplierCoin` is `USDT`.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no FameEX class: `ccxt.exchanges` lists 104 ids and none contains `fame`, P1.
The current CCXT master, commit `1d8b674434` of 2026-09-22, has no `fameex.ts` in `ts/src`, S11.
Pull request 28154, "Add FameEX exchange (futures/swap)", opened 2026-03-16 and last updated 2026-09-13, is open and unmerged, S12.
So the engine's catalog, which is `loadMarkets` of a CCXT class at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, has nothing to load.
A hand-written catalog would map the rows as follows.

| engine field | FameEX source | note |
|---|---|---|
| `rawMarketId` | `symbol`, such as `E-BTC-USDT` | REST spells it this way. The socket spells `market_e_btcusdt_depth_step0`, see [`websocket.md`](./websocket.md) section 2 |
| `base` | `base` from `contract_config`, or the middle of `symbol` | `1000PEPE` and `1000SHIB` keep the prefix |
| `quote` | `USDT` | |
| `linear` | `side` 1 | all 246 |
| `contractSize` | `multiplier` | the book size unit is contracts, an inference, see [`websocket.md`](./websocket.md) section 4 |
| active | `status` 1 | 213 |

### Size unit, pairs listed twice, and price scale

No pair is listed twice among the 246 rows, P1.
`E-1000PEPE-USDT` and `E-1000SHIB-USDT` are priced per 1,000 tokens: their index read 0.00501835 and 0.00620811 at about 04:30 UTC on 2026-09-23, C3, and both have `multiplier` 1000, so one contract is 1,000,000 tokens.
The inactive `E-PEPE-USDT` and `E-SHIB-USDT` remain in the list with status 0.
A venue that lists plain PEPE would need a price scale entry against these, at [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) line 20.
The six contracts whose `multiplierCoin` is `USDT` are `E-BSB-USDT` (5), `E-BABA-USDT` (0.02), `E-PTB-USDT` (4000), `E-MEITUAN-USDT` (0.4), `E-KUAISHOU-USDT` (1) and `E-LGELECTRONICS-USDT` (0.02).
What one of their contracts is worth in the base is Not verified, so a catalog should skip them.
`E-KUAISHOU-USDT` also showed the largest mark to index gap of all, section 4.

## 3. Anchor

### The bulk calls

No documented call returns index, mark or funding for every perpetual at once.

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/index?contractName=E-BTC-USDT`, documented, one contract | `indexPrice` | `tagPrice` | `nextFundRate` and `currentFundRate` | absent | absent | 187 to 210 bytes | median 232 and 264 ms over 213 contracts, max 443 and 492 ms, P3 |
| `GET /fapi/v1/index` without `contractName` | | | | | | `{"code":"-1121","msg":"无效的合约","data":null}` | P2 |
| `GET /fapi/v1/index?contractName=E-BTC-USDT,E-ETH-USDT` | | | | | | code -1121 | P2 |
| `GET /fapi/v1/ticker` without `contractName` | | | | | | code -1121 | P2 |
| `GET /fapi/v1/tickers`, `/ticker/all`, `/premiumIndex`, `/markPrice`, `/openInterest` | | | | | | code -1002, "the request needs an API key" | P5 and C1 |
| `GET /v1/inner/contract_config`, undocumented | | | | `capitalFrequency`, hours | absent, derivable, section 4 | 141,561 bytes, 213 rows | 1,245 to 1,682 ms, P3 and P6 |
| `GET /fapi/v1/fundingRate`, undocumented | | | settled rates only | | | the 100 most recent funding rows across all contracts, 7.3 KB | 864 to 914 ms, and once `{"code":"-1000"}` after 1,317 ms, P2 |

The website's own futures page reads its prices from `POST /fe-co-api/common/public_market_info` with a body of one `contractId`, according to its JavaScript bundle, C2.
That call was not made, and it is per contract too.
So a full anchor round is one `/index` call per contract, 213 calls for the whole catalog.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the `contractName` the call was made with | `E-BTC-USDT` | none, the reply does not echo it |
| `index` | `indexPrice` | JSON number, up to 16 decimals | none |
| `mark` | `tagPrice` | JSON number | none, never 0 on 213 contracts in two surveys |
| `fundingRate` | `nextFundRate` | JSON number, a fraction per interval: `0.00005` is 0.005 % | none, see section 4 for which settlement it describes |
| `fundingIntervalHours` | `capitalFrequency` from `contract_config` | integer hours: 1, 2, 4 or 8 | none |
| `nextFundingAt` | computed | | the next multiple of `capitalFrequency` hours after 00:00 UTC, in ms, see section 4 |

`capitalStartTime` is 0 on all 213 rows, P6, and every contract's last settlement fell on a multiple of its interval counted from 00:00 UTC, P3.

## 4. Anchor semantics

### Index

S1 describes `indexPrice` only as "Index price".
The index formula, its constituent venues and their weights are Not publicly specified, and no basket call was found.
The index of `E-BTC-USDT` moved rarely: 2, 2 and 3 times in 59 one second polls over three runs, and in the third run only at polls 10, 28 and 38, so it sat flat for at least 21 s, P2.
In the same polls the ETH index moved 38, 21 and 26 times, and the `E-AAPL-USDT` index 44, 37 and 49 times.
A flat BTC index while the last price moved 46, 20 and 34 times is the shape the anchor reader cannot tell from a quiet market.

### Mark

S1 describes `tagPrice` only as "Mark price".
The mark formula and any clamp on it are Not publicly specified.
On 65 and 77 of 213 contracts in the two surveys the mark equalled `newPrice`, the last trade, to every digit, P3.
`E-ZIL-USDT` was one of them, with its mark 2,177 to 4,475 ppm below its index across three runs of 60 polls, P2.
The gap between mark and index over all 213 contracts had a median of 679 and 674 ppm, a 90th percentile of 2,514 and 2,229 ppm, and a maximum of 88,409 and 87,478 ppm on `E-KUAISHOU-USDT`, whose index was 4.294 while its last trade was 3.914, P3 and C3.
72 and 74 contracts had a gap over 1,000 ppm, P3.
On BTC and ETH the gap stayed within −170 to 131 ppm, P2.

`contract_config` carries `capitalPremiumMin` −0.0005 and `capitalPremiumMax` 0.0005 on all 213 contracts, and `priceRange` 0.05 on 211 of them, P6.
Their meaning is Not publicly specified.
They do not cap the funding rate, since settled rates reached −0.01285754, see below.

### Funding

The funding formula is Not publicly specified in S1 or in the help centre articles read, S7.
S1 describes `nextFundRate` as "Funding rate price" and `currentFundRate` as "Previous funding rate (used for this period's settlement)".

| reading | survey at 04:33 UTC | survey at 04:43 UTC |
|---|---|---|
| `nextFundRate` minimum, on `E-KERNEL-USDT` | −0.00427332 | −0.00392366 |
| `nextFundRate` median | 0.00005 | 0.00005 |
| `nextFundRate` maximum | 0.00098702, `E-KUAISHOU-USDT` | 0.00091316, `E-KUAISHOU-USDT` |
| contracts with `nextFundRate` exactly 0.00005, 0.0001 and 0 | not counted | 77, 52 and 17 |
| `currentFundRate` range | −0.005486 to 0.00119236 | the same |
| last settled rate range, from the history | −0.00542398 to 0.00119286 | the same |
| `currentFundRate` equal to the last settled rate | 145 of 213 | 145 of 213 |
| contracts with a `nextFundRate` beyond ±0.0005 | 9 | 9 |

`E-KERNEL-USDT` settled at −0.00793749, −0.01251201, −0.00980043, −0.00917475, −0.00517034, −0.01285754 and −0.00542398 at the seven 4 h settlements from 2026-09-22 04:00 to 2026-09-23 04:00 UTC, C4.
So a rate beyond 1.28 % per 4 h has settled, and the cap, if one exists, is Not publicly specified.
`nextFundRate` changed exactly once in each 59 s run on BTC, ZIL and AAPL and not at all on ETH, whose rate sat at 0.0001, so it is recomputed about once a minute, P2.
`nextFundRate` is taken as the rate for the upcoming settlement, and that reading is an inference from its name and its once a minute movement.
Because `currentFundRate` matched the last settled rate on only 145 of 213 contracts, what it describes is not settled either.

### Interval and settlement

| source | 1 h | 2 h | 4 h | 8 h |
|---|---|---|---|---|
| `contract_config` `capitalFrequency`, P6 | 1, `E-G-USDT` | 1, `E-FLOKI-USDT` | 124 | 87 |
| median spacing of the last settlement rows in `/fapi/v1/fundingRate?symbol=` | 1 | 1 | 124 | 83 |

The two agree on 209 of 213 contracts in both surveys, P3.
The other four, `E-AAPL-USDT`, `E-COST-USDT`, `E-SKHY-USDT` and `E-JPM-USDT`, have too few on-the-hour rows in their last 100 history rows to measure.
That is because 47 contracts, mostly equity perpetuals, write extra rows off the hour, such as rate 0 rows about every 70 s while the home market of the underlying is shut, and settlement rows repeated seconds apart, such as `E-NVDA-USDT` at 08:00:00 and 08:00:40 on 2026-09-21, C4.
Every contract's last settlement fell on a multiple of its `capitalFrequency` from 00:00 UTC: 126 at 04:00 UTC and 87 at 00:00 UTC on 2026-09-23, with none overdue, P3.
The history of `E-BTC-USDT` holds 100 settlements from 2026-08-21 00:00 to 2026-09-23 00:00 UTC, every 8 h, and 17 of the 99 gaps between them were one second longer or shorter than 8 h, C4.
The help centre article of 2023 says perpetuals settle every 8 hours at 00:00, 08:00 and 16:00 UTC+8, and that "During the settlement period, the trading will be suspended", S7.
The 4 h, 2 h and 1 h intervals seen today are not in that article.
The settlement instant itself was not captured.

### How often each number changed

Three runs of 60 one second polls on four contracts, 59 intervals each, P2.

| contract | `indexPrice` | `tagPrice` | `newPrice` | `nextFundRate` | reply median |
|---|---|---|---|---|---|
| `E-BTC-USDT` | 2, 2, 3 | 26, 7, 13 | 46, 20, 34 | 1, 1, 1 | 248, 363, 287 ms |
| `E-ETH-USDT` | 38, 21, 26 | 35, 35, 36 | 45, 38, 38 | 0, 0, 0 | 257, 367, 268 ms |
| `E-ZIL-USDT` | 2, 2, 5 | 3, 15, 3 | 1, 3, 3 | 1, 1, 1 | 254, 353, 255 ms |
| `E-AAPL-USDT` | 44, 37, 49 | 43, 38, 29 | 0, 3, 1 | 1, 1, 1 | 246, 359, 268 ms |

The slowest single reply was 1,244 ms, on BTC in the first run, and every other reply took 507 ms or less.

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=100`, documented in S1, P4.

| item | value |
|---|---|
| depth | `limit` 5, 20 and 100 return exactly that. 101 and 1000 return 100, and no `limit` returns 100. S1 says "Default: 100. Maximum: 100" |
| level order | bids descending, asks ascending, at every limit |
| numbers | `[price, size]` as JSON numbers, size in contracts |
| `time` | `null` on every reply, although S1 documents a timestamp |
| reply | 163 bytes at limit 5, about 2,640 bytes at 100, 230 to 470 ms |
| caching | no `cache-control` or `age` header. Ten reads 200 ms apart gave 7 and 6 distinct tops |
| lowercase `e-btc-usdt` | accepted |
| unknown contract, or no `contractName` | code -1121 |
| closed contract `E-HIFI-USDT` | a stale book, `{"asks":[[25,7]],"bids":[[0.002,25000]],"time":null}` |

The socket carries the same sizes at the same prices, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

S1 publishes no limit for any futures endpoint, public or private.
The spot trade endpoints carry limits such as "100 requests per 2 seconds" on order creation and "20 requests per 2 seconds" on order queries, S1.
The FAQ says public data is limited by IP and private data by API key, that 429 means the limit was exceeded, and that "Under normal circumstances, the IP will not be blocked", S1.
The status code section says 429 is a warning and 418 follows when a client keeps going after a 429, S1.
No reply carried a rate limit header, and no probe went near a limit: the anchor mode ran four calls a second, P2, and the survey at most five a second, P3.
Whether a limit reply carries `Retry-After` is Not verified.

Every error came back as HTTP 200 with `content-type: application/json`, P5.

| request | body |
|---|---|
| `/fapi/v1/index?contractName=E-NOPE-USDT`, or no `contractName` | `{"code":"-1121","msg":"无效的合约","data":null}`, "invalid contract" |
| `/fapi/v1/ticker?contractName=E-NOPE-USDT` | the same |
| an unknown path such as `/fapi/v1/nope`, or `/fapi/v1/tickers` | `{"code":"-1002","data":null,"msg":"您无权执行此请求。请求需要发送API Key，我们建议在所有的请求头附加X-CH-APIKEY","succ":false}`, "not authorized, the request needs an API key" |
| `/fapi/v1/depth?contractName=E-BTC-USDT&limit=abc` | `{"code":"-1000","msg":"处理请求时发生未知错误","data":null}`, "unknown error while processing the request" |
| `/fapi/v1/klines?contractName=E-BTC-USDT&interval=1min&limit=2` | `[]` |

The error codes of S1 use the same numbers with English messages, such as `{"code": -1121, "msg": "Invalid symbol."}`, while the wire sends the code as a string and the message in Chinese.
A poller has to read the body, since the status code is 200 on success and on failure.
Private calls are signed with `X-CH-APIKEY`, `X-CH-SIGN` (HMAC SHA256) and `X-CH-TS`, S1.

## 7. Server time and clock offset

`GET /fapi/v1/time` returned `{"timezone":"China Standard Time","serverTime":1790136845301}` at 04:14 UTC, with `serverTime` in Unix ms, C1 and P5.
Over ten calls in each of two runs, the server clock ran ahead of this host by 11 and 8 ms at the median, within −6.5 to 34 ms, with a round trip of 253 and 368 ms at the median.
The spot `GET /sapi/v1/time` returned `{"server_time":…,"timezone":"UTC"}`, 7.5 and 6 ms ahead.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://futuresopenapi.fameex.com/fapi/v1/index?contractName=<rawMarketId>`, one call per tracked contract | no bulk call exists |
| scope | only the contracts in clusters, not all 213 | a full round at 1 s is 213 calls a second against an unpublished limit |
| interval | 2,000 ms, with the calls of a round spread across it | the reader refuses legs read more than 5 s apart, so a round has to finish well inside that. The BTC index changed no more than three times a minute anyway |
| second call | `https://futuresopenapi.fameex.com/v1/inner/contract_config` every 60 s, for `capitalFrequency` | the interval changes rarely, and the call is undocumented and takes about 1.3 s |
| row mapping | section 3 | |
| `nextFundingAt` | `Math.ceil(now / (h × 3,600,000)) × h × 3,600,000` for `capitalFrequency` h | `capitalStartTime` is 0 and 213 of 213 last settlements sat on that grid |
| error handling | treat any body with a `code` field as a failed read, whatever the status | errors arrive as HTTP 200 |
| rate limit pause | pause on 429 or 418 for 10,000 ms, or `Retry-After` when present | the documented codes, with no published window |
| skip | status 0 contracts, and the six whose `multiplierCoin` is `USDT` | a closed contract returns a stale book, and the six have an unknown coin unit |
| flag | contracts whose mark equals the last trade, 65 and 77 of 213 | such a mark is the traded price and not an independent reference |
| deny list input | `E-KUAISHOU-USDT`, whose index and last trade differed by about 88,000 ppm in both surveys | a ticker whose index and book disagree this much is not the same asset the engine assumes |

The design has not yet seen a venue whose anchor is per contract only at this size, so the poller shape itself is the named change, see [`fees.md`](./fees.md) section 9.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | FameEX OpenAPI Docs, Slate source `source/includes/_doc.en.md` at commit `7c8ed3c1` of 2026-08-12 | https://github.com/fameexDocs/docs-v1, rendered at https://fameexdocs.github.io/docs-v1/en/ | 2026-09-22 | FameEX, global | endpoints, fields, status codes, limits, FAQ, sections 2 to 7 |
| S2 | FameEX OpenAPI Docs, `locales/en.yml` | https://github.com/fameexDocs/docs-v1/blob/main/locales/en.yml | 2026-09-22 | FameEX, global | host names, section 1 |
| S7 | FameEX help centre, "Introduction to USDⓈ-M Perpetual", dated 2023-07-22 | https://www.fameex.com/en-US/support/swap/introduction-to-usd-m-perpetual | 2026-09-22 | FameEX | 8 h settlement at 00:00, 08:00 and 16:00 UTC+8, trading suspended during settlement, section 4 |
| S11 | CCXT master, `ts/src` at commit `1d8b674434` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no FameEX class, section 2 |
| S12 | CCXT pull request 28154, "Add FameEX exchange (futures/swap)" | https://github.com/ccxt/ccxt/pull/28154 | 2026-09-22 | CCXT | open and unmerged, names `/v1/inner/contract_config`, sections 2 and 3 |
| P1 | `rest-probe.mjs catalog`, runs at 04:25 and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | host, catalog, CCXT check, spot count, sections 1 and 2 |
| P2 | `rest-probe.mjs anchor`, runs at 04:25, 04:42 and 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | bulk attempts, one second polls, sections 3 and 4 |
| P3 | `rest-probe.mjs survey`, runs at 04:33 and 04:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | every active contract's index, mark, rates, interval and last settlement, sections 2 to 4 |
| P4 | `rest-probe.mjs book`, runs at 04:32 and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | REST book, section 5 |
| P5 | `rest-probe.mjs limits`, runs at 04:32 and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | headers, errors, clock, sections 1, 6 and 7 |
| P6 | `rest-probe.mjs config`, runs at 04:52 and 04:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | `contract_config` against the contract list, sections 2 to 4 |
| C1 | `curl` of `/fapi/v1/ping`, `/time` and `/contracts`, `/sapi/v1/time`, then `/fapi/v1/tickers`, `/ticker/all`, `/premiumIndex`, `/markPrice`, `/fundingRateHistory` and `/openInterest` | `https://futuresopenapi.fameex.com/fapi/v1/` | 2026-09-23 04:14 to 04:16 UTC | this host | the time replies, and code -1002 on each unknown call, sections 3 and 7 |
| C2 | the futures page bundle, `https://www.fameex.com/en-US/swap/E-BTC-USDT` and its `_next/static/chunks` | https://www.fameex.com/en-US/swap/E-BTC-USDT | 2026-09-23 04:28 UTC | this host | `public_market_info` is a POST with one `contractId`, section 3 |
| C3 | `curl` of `/fapi/v1/index` for `E-1000PEPE-USDT`, `E-1000SHIB-USDT` and `E-KUAISHOU-USDT` | `https://futuresopenapi.fameex.com/fapi/v1/index` | 2026-09-23 04:30 UTC | this host | price scale, the KUAISHOU gap, sections 2 and 4 |
| C4 | `curl` of `/fapi/v1/fundingRate?symbol=` for `E-BTC-USDT`, `E-KERNEL-USDT`, `E-NVDA-USDT`, `E-CAT-USDT` and `E-G-USDT` | `https://futuresopenapi.fameex.com/fapi/v1/fundingRate` | 2026-09-23 04:17 to 04:27 UTC | this host | settlement history, section 4 |
