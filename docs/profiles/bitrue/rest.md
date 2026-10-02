# Bitrue REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 03:07 to 03:48 UTC, which is the evening of 2026-09-22 on the development host near Seattle.

This profile covers the public futures REST API of Bitrue (CCXT id `bitrue`) that a catalog, an anchor poller and a book resync would use, for every perpetual family.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.
The official API has no bulk index or mark, so this profile also records the calls the futures web page makes without login, labelled "web" and hosted on `futures.bitrue.com/fe-co-api`.
Those web calls are undocumented, and Bitrue can change them without notice.

## 1. Host and latency from this machine

| host | resolves to | from this host |
|---|---|---|
| `fapi.bitrue.com` | CNAME `d3gmr6czfft8x8.cloudfront.net`, four IPv4 addresses in `52.85.129.0/24` | served by CloudFront POP `SEA900-P10`, `x-cache: Miss from cloudfront` on every reply, so nothing is cached at the edge |
| `futures.bitrue.com`, web API | CNAME `d1zzcj29v1dcm4.cloudfront.net` | HTTP 200 |
| `fmarket-ws.bitrue.com` | CNAME `futures-ws-alb-601002812.ap-southeast-1.elb.amazonaws.com` | Singapore, see [`websocket.md`](./websocket.md) |
| `futuresws.bitrue.com` | CNAME `finance-futures-ngx-alb-out-1821070362.ap-southeast-1.elb.amazonaws.com` | Singapore |

| call | cold | warm |
|---|---|---|
| `GET /fapi/v1/time` | 264 and 587 ms in two runs | 171 to 699 ms over ten calls a second apart |
| `GET /fapi/v1/contracts`, 253,341 bytes | 873 and 1,166 ms | 195 and 1,189 ms |
| `GET /fapi/v1/index`, one contract | | 764 calls in each of two runs: median 193 ms, p90 508 and 498 ms, max 706 and 1,435 ms |

The warm times are bimodal, near 180 ms or near 500 to 700 ms, on every call type.
No public REST call was refused, and no reply carried a rate limit header.

## 2. Catalog

### The instruments call

| family | call | rows | fields |
|---|---|---|---|
| USDT-M and USDC-M | `GET https://fapi.bitrue.com/fapi/v1/contracts` | 764: 726 USDT, 38 USDC | `symbol`, `pricePrecision`, `side`, `maxMarketVolume`, `multiplier`, `minOrderVolume`, `maxMarketMoney`, `type`, `maxLimitVolume`, `maxValidOrder`, `multiplierCoin`, `minOrderMoney`, `maxLimitMoney`, `status` |
| COIN-M | `GET https://fapi.bitrue.com/dapi/v1/contracts`, 6,886 bytes | 21, quoted in USD | same fields |

Every row on both calls had `type` `"E"`, which S1 defines as "perpetual contract", and `status` `1`, which S1 defines as "can trade".
`side` is 1 on every linear row and 0 on every COIN-M row.
The documentation lists no query parameter for this call, and the reply is one unpaged array.
Of the 726 USDT-M contracts, 176 are TradFi names, equities such as `E-NVDA-USDT`, ETFs such as `E-QQQX-USDT`, indices such as `E-NAS100-USDT`, metals, energy, and pre-IPO names `E-OPENAI-USDT` and `E-ANTHROPIC-USDT`, which the futures web page leaves out of its crypto list, see [`fees.md`](./fees.md) section 3.

### How CCXT 4.5.68 maps it

| field | CCXT | evidence |
|---|---|---|
| `market.id` | the row's `symbol`, `E-BTC-USDT` | `server/node_modules/ccxt/js/src/bitrue.js` line 934 |
| `base`, `quote` | split of the symbol on `-`, parts 1 and 2 | lines 954 to 956 |
| `linear` | `side === 1`, true on 764 and false on 21 | line 945, P1 |
| `contractSize` | `multiplier`, equal on 785 of 785 swaps | line 1010, P1 |
| `active` | `status === 'TRADING'`, which is false on 785 of 785 swaps, since the wire sends the number `1` | line 1006, P1 |
| `taker` | 0.00098, the spot fee, see [`fees.md`](./fees.md) section 8 | P1 |

CCXT loaded 2,482 markets in 2,339 ms, 785 of them swaps, P1.
CCXT's master branch on 2026-09-22 still has `'active': (status === 'TRADING'),` in `ts/src/bitrue.ts`.

The `active` flag is a blocker for the catalog.
The connector keeps only markets whose `active` is not `false`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, and then logs `no usable swap markets; skipping the venue` at line 51.
So today the engine would load zero Bitrue markets.
`marketFilter` runs after that filter, so it cannot restore them.
The named change is a connector option that decides activity for this venue from `market.info.status === 1`, or a fix in CCXT that reads the numeric status.

### Identifiers across the three surfaces

| surface | spelling for BTC on USDT-M | rule from `market.id` |
|---|---|---|
| CCXT `market.id`, the REST `contractName` parameter | `E-BTC-USDT` | identity |
| socket stream id | `e_btcusdt` | `'e_' + base + quote`, lower case, as CCXT Pro builds it at `server/node_modules/ccxt/js/src/pro/bitrue.js` lines 321 to 325 |
| `GET /fapi/v1/index` reply | none, the reply carries no symbol | the key is the query parameter |
| web funding list | `contractName` `BTCUSDT`, `symbolAlias` `BTC-USDT` | `contractName` is `market.id` without `E-` and dashes. `symbolAlias` differs from it on 21 rows, such as `PAXGUSDT` with alias `GOLD(PAXG)-USDT` |

The 785 swaps map to 785 distinct socket ids, so the lower case transform collides nowhere, P1.

### Size unit, pairs listed twice, and price scale

The REST and socket books count contracts, and one contract is `multiplier` coins, which is CCXT's `contractSize`, see [`websocket.md`](./websocket.md) section 4.
`E-BTC-USDT` has `multiplier` 0.0001, `E-ETH-USDT` 0.001, `E-XRP-USDT` 1, and 21 distinct multipliers exist from 0.00001 to 1,000, P1.
42 bases have more than one swap, USDT-M and USDC-M and sometimes COIN-M, so the quote family's per venue choice applies, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
15 bases carry a size prefix in the name, such as `E-1000PEPE-USDT`, `E-1MBABYDOGE-USDT` and `E-1000000MOG-USDT`, and CCXT keeps the prefix in `base`, so they cluster only with venues that spell the base the same way.
The 176 TradFi contracts include `OPENAI` and `ANTHROPIC`, which the engine has denied by hand on other venues before, see [`server/src/engine/cluster/clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/index?contractName=E-BTC-USDT`, official, S1 | `indexPrice` | `tagPrice` | `currentFundRate`, equal to `nextFundRate` on 764 of 764 | absent | `remainingSecond`, whole seconds | 142 bytes, one contract | 240 polls in each of two runs: median 192 and 194 ms, p90 520 ms, max 702 and 668 ms |
| `GET /dapi/v1/index?contractName=E-BTC-USD`, official | same | same | same | absent | same | one contract | 718 ms, one call by curl |
| web `GET /fe-co-api/common/funding_rate_real_time?symbol=USDT` | absent | absent | `fundingRate` | `capitalFrequency`, hours | `remainingSecond` | 150,998 and 150,509 bytes, 726 rows | 60 polls in each of two runs: median 968 and 983 ms, p90 1,045 and 1,049 ms, max 1,131 and 1,178 ms |
| web, `symbol=USDC` | absent | absent | same | same | same | 38 rows | |
| web, `symbol=USD` | | | | | | `"data":[]`, no COIN-M rows | |
| web `POST /fe-co-api/common/public_market_info` with `{"contractId":1}` | `indexPrice` | `tagPrice` | `currentFundRate` | absent | `remainingSecond` | one contract | the same numbers as the official call |

No call returns index and mark for more than one contract.
`GET /fapi/v1/index` without `contractName` answers `{"code":"-1121","msg":"Invalid contract","data":null}`, and `/fapi/v1/premiumIndex` and `/fapi/v1/fundingRate` answer code `-1002`, "Requests must send an API Key", P1.
The socket has no mark, index or funding channel, see [`websocket.md`](./websocket.md) section 2.

The `AnchorPoller` asks `fetchRound` for every row of a round at once, keyed by `rawMarketId`, at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) lines 103 and 245, and polls once a second, at line 34.
Every existing poller fills a round from one bulk call, such as Gate's at [`server/src/venues/gate/anchor.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/gate/anchor.ts) line 21.
On Bitrue a round is one request per tracked market, so one request per market per second.
With 726 USDT-M contracts that is 726 requests per second against a futures rate limit Bitrue does not publish, section 6.
The survey of 764 contracts at 5 requests per second drew no refusal, P3, and nothing faster was tried.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the `contractName` query parameter | string, `E-BTC-USDT` | none |
| `index` | `indexPrice` | JSON number, `86482.01000000` | none |
| `mark` | `tagPrice` | JSON number, never 0 on 764 contracts | none |
| `fundingRate` | `currentFundRate` | JSON number, a fraction per interval: `0.00003584` is 0.003584 % | none |
| `fundingIntervalHours` | absent from the official call. Web `capitalFrequency` | integer hours: 1, 4 or 8 | none |
| `nextFundingAt` | `remainingSecond` | integer seconds to the next settlement | arrival time plus `remainingSecond` × 1,000, rounded to the whole second |

`remainingSecond` was 17,082 on BTC and 2,682 on LSK at 03:15:17 UTC, which points at 08:00 UTC and 04:00 UTC, P2.
At the end of each anchor run the official call and the web list agreed on `remainingSecond` to the second, and disagreed on the rate, P2.
In the first run BTC read 0.00003735 against 0.00003667 and ETH 0.00010045 against 0.00010196, and in the second BTC read 0.0000431 against 0.0000426 and ETH 0.00010179 against 0.0001002.
In the first run the web rate equalled the official rate of the first round, 60 s earlier, on both BTC and ETH, so the web list can lag the official call.

## 4. Anchor semantics

### Index

"Index price refers to the value of the contract over several different market locations, including at Bitrue itself.", S2.
The constituent exchanges and weights are Not publicly specified, and no basket call was found in the API or the web bundle.
An index that includes Bitrue's own market is the shape that has produced false rows before, see [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and Bitrue gives no way to measure its share.
The TradFi contracts read a funding rate of exactly 0 on `E-AAPLX-USDT`, `E-GVZ-USDT` and `E-QQQX-USDT` while their mark stood 3.8 % to 7.4 % above the index, in both surveys, at about 03:35 and 03:46 UTC on a Wednesday, which is outside US equity hours, P3.
Their index did not move between the two surveys: 317.41, 23.59 and 720.07 both times, so a closed market leaves the index frozen while the mark trades.

### Mark

"The mark price is calculated by finding the median value from the Latest Price, the Reasonable Price, and the Moving Average Price.", S2.

```text
Latest Price         = Median(Buy 1, Sell 1, Trade Price)
Reasonable Price     = Index price * (1 + capital rate of the previous period * (time between now and the next charge of funds / collection of funds rate interval))
Moving Average Price = Index Price + 60-Minute Moving Average (Spread)
Spread               = The exchange's median price - index price
```

No clamp on the mark premium is documented, and none shows on the wire.
Over the 764 contracts the absolute premium of `tagPrice` over `indexPrice` had a median of 848 and 903 ppm and a p90 of 3,450 and 3,810 ppm in the two surveys, and 64 and 79 contracts stood beyond 3,750 ppm, 14 and 16 beyond 10,000 ppm, P3.
The largest was `E-NESA-USDT` at +444,444 and +445,313 ppm, an index of 0.1152 in both surveys against a mark of 0.1664 and 0.1665, so its index was frozen too.
So the mark can follow the contract's own trades far from the index, and a capped mark is not the risk here.
Two of the three mark inputs are the index plus a premium, so a stale index drags the mark with it.

### Funding

| item | value | source |
|---|---|---|
| formula | Not publicly specified beyond the charge, see [`fees.md`](./fees.md) section 6 | S2 |
| base interest | web `capitalRate`, labelled "base interest rate" by the web page, 0.0001 on 706 of 726 USDT-M rows and on 38 of 38 USDC-M rows, and 15 other values from 0.00002 to 0.008 on the remaining 20 | P1, web bundle |
| listed limit | web `capitalPremiumMin` and `capitalPremiumMax`, labelled "funding rate upper lower limit", ±0.00375 on 723 USDT-M and 38 USDC-M rows | P1 |
| is it a cap | no, the live rates of `E-ONE-USDT`, `E-BLAST-USDT` and `E-KERNEL-USDT` sat beyond it on every read, KERNEL between -0.0061 and -0.0083, and KERNEL settled at -0.013178 at 00:00 UTC | P1, P2, P3 |
| upcoming or settled | upcoming: BTC read 0.00003584 to 0.0000431 live, while the funding history records 0.00001 settled at 00:00 UTC | P1, P2 |
| rounding of the settled rate | six decimals in the history, such as `1.03E-4`, against eight in the live rate | P1 |

The funding history call is web `POST /fe-co-api/common/funding_rate_history` with `{"symbol":"BTC-USDT","page":1,"rows":6}`, and each record carries `symbol`, `markPrice`, `fundingIntervalHours`, `calcTime` in ms and `lastFundingRate`, P1.
The settlement instant itself was not captured.

### How often each number changed

60 rounds of `GET /fapi/v1/index`, one second apart, from 03:15:17 and from 03:44:09 UTC, P2.
Each cell counts changes between consecutive rounds, 59 intervals per run.

| contract | `indexPrice` changed | `tagPrice` changed | `currentFundRate` changed | `remainingSecond` changed |
|---|---|---|---|---|
| `E-BTC-USDT` | 25 and 31 | 30 and 29 | 12 and 12 | 56 and 55 |
| `E-ETH-USDT` | 29 and 39 | 23 and 44 | 12 and 12 | 53 and 55 |
| `E-LSK-USDT` | 5 and 10 | 13 and 17 | 12 and 12 | 54 and 57 |
| `E-BTC-USDC` | 28 and 31 | 27 and 32 | 12 and 12 | 51 and 55 |

The rate moved 12 times in 59 intervals on every contract, so it is recomputed about every 5 s.
The index and mark of a busy contract moved on about every other poll.
`remainingSecond` missed a change on a few polls because two polls can land in the same second.
The first round's premiums were -453 and -477 ppm on BTC-USDT, -622 and -381 on ETH, -6,556 and -5,941 on LSK, and -500 and -545 on BTC-USDC.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET https://fapi.bitrue.com/fapi/v1/depth?contractName=E-BTC-USDT&limit=100`, S1 |
| depth | "Default 100, Max 100", S1. `limit=5` and `limit=30` returned 5 and 30 per side, `limit=100` returned 100 bids with 81 and 80 asks, and `limit=200` returned at most 100 per side, P1 |
| shape | `{"asks":[[price, size], …],"bids":[…],"time":<ms>}` with JSON numbers |
| level order | bids descending and asks ascending at every limit, P1 |
| size unit | contracts, the BTC best bid read `865981` in the first run, which is 86.6 BTC |
| caching | none seen: in each run five calls 250 ms apart each carried a new `time`, the best bid size changed between most of them, and `x-cache` read Miss |
| freshness | the reply arrived a median 500 and 458 ms after its `time` over 40 calls in each of two runs, and this book is about 7 s ahead of the socket book, see [`websocket.md`](./websocket.md) section 4 |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published futures limit | "There will be a limited frequency description below each interface.", and no endpoint gives one | S1 |
| status codes | "HTTP 429 return code is used when breaking a request rate limit.", "HTTP 418 return code is used when an IP has been auto-banned for continuing to send requests after receiving 429 codes." | S1 |
| `Retry-After` | not documented, and no limit was reached, so not observed | S1, P1 |
| CCXT's assumption | `rateLimit` 10 ms and a cost of 0.24 per public futures call, about 416 calls per second, derived from the spot limit "general 25000 weight in 1 minute per IP" | `server/node_modules/ccxt/js/src/bitrue.js` lines 24, 165 and 225 to 236 |

Errors come back with HTTP 200 and a code in the body.

| request | status | body |
|---|---|---|
| `/fapi/v1/index`, `/fapi/v1/depth` without `contractName`, or with `E-NOPE-USDT`, `e-btc-usdt` or `BTCUSDT` | 200 | `{"code":"-1121","msg":"Invalid contract","data":null}` |
| an unknown path such as `/fapi/v1/nope` | 200 | `{"args":null,"code":"-1002","data":null,"msg":"You are not authorized to execute this request. Requests must send an API Key, please append X-CH-APIKEY to all request headers","succ":false}` |
| web funding list without `symbol` | 200 | `{"code":"200004","msg":"symbol parameter illegal","args":null,"data":null,"succ":false}` |

A poller therefore has to read the body, since HTTP 200 never trips the pause on 403, 418 and 429 at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 192.
A body code that means a rate limit would be thrown as `RateLimitReplyError`, as the MEXC poller does at [`server/src/venues/mexc/anchor.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/mexc/anchor.ts) line 24, but Bitrue documents no such code.

## 7. Server time and clock offset

`GET https://fapi.bitrue.com/fapi/v1/time` answers `{"serverTime":1790132846126,"timezone":"China Standard Time"}`.
Ten samples a second apart, five per run, split into two groups by round trip, P1.

| round trip | samples | server minus the midpoint of the request |
|---|---:|---|
| 180 and 193 ms | 2 | +7 and +6.5 ms |
| 497 to 534 ms | 8 | +160 to +177 ms |

The fast samples put the server clock within about 7 ms of this host.
The slow samples spend about 330 ms more on the way in than on the way out, which is the same bimodal latency section 1 shows, and it is not clock error.
So `serverTime` is usable, and only a fast round trip measures the offset.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
Bitrue does not fit the anchor poller today, because no call returns index and mark in bulk.

| item | recommendation | reason |
|---|---|---|
| URL | `https://fapi.bitrue.com/fapi/v1/index?contractName=<rawMarketId>`, one request per tracked market, and `/dapi/` for COIN-M | the only public source of index and mark |
| interval | not viable at 1,000 ms for more than a handful of markets | one request per market per second, against an unpublished limit |
| interval and next settlement | `GET https://futures.bitrue.com/fe-co-api/common/funding_rate_real_time?symbol=USDT` every 60 s for `capitalFrequency`, and `remainingSecond` from the index call | the official call has no interval, and intervals change, see [`fees.md`](./fees.md) section 6 |
| row mapping | section 3 | |
| skip | the 176 TradFi contracts | a frozen index, a zero funding rate and a mark 3.8 % to 7.4 % off the index while their markets are closed |
| errors | treat any body with a `code` field as a failed round | errors arrive as HTTP 200 |
| rate limit pause | `rateLimitPauseMs` 60,000 | the only published window is the spot minute, and no `Retry-After` is documented |

If Bitrue ever joins, the smallest honest shape is a poller over only the markets that cluster with another venue, spread so each market is read every few seconds.
That would still leave each reading up to several seconds old against the reader's 10 s age limit and 5 s skew limit at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 4 and 5, and it needs a design of its own.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitrue Futures API documentation | https://www.bitrue.com/api_docs_includes_file/futures/index.html | 2026-09-22 | Bitrue, global | endpoints, fields, depth limits, status codes, sections 2, 3, 5, 6 |
| S1b | Bitrue USDT-M futures API v1 documentation on GitHub, `future_open_api.md` | https://github.com/Bitrue-exchange/USDT-M-Future-open-api-docs/blob/main/future_open_api.md | 2026-09-22 | Bitrue, global | `/fapi/v1/index` and its fields, which the HTML documentation omits, section 3 |
| S2 | Beginners Guide to USDT Futures | https://support.bitrue.com/hc/en-001/articles/4409416662937, read through https://support.bitrue.com/api/v2/help_center/en-001/articles/4409416662937.json | 2026-09-22 | Bitrue, global | index, mark and funding definitions, section 4 |
| S3 | Bitrue futures web bundle | https://www.bitrue.com/futures and its scripts under `/futures/includes/` | 2026-09-22 | Bitrue, global | the web API host and calls, the labels of `capitalRate` and `capitalPremiumMax`, sections 3 and 4 |
| S4 | CCXT 4.5.68 `bitrue.js` and CCXT Pro `bitrue.js` | `server/node_modules/ccxt/js/src/bitrue.js`, `server/node_modules/ccxt/js/src/pro/bitrue.js` | 2026-09-22 | CCXT | market mapping, rate limit assumption, sections 2 and 6 |
| S5 | CCXT master `ts/src/bitrue.ts` | https://github.com/ccxt/ccxt/blob/master/ts/src/bitrue.ts | 2026-09-22 | CCXT | the `active` rule is unchanged on master, section 2 |
| P1 | `rest-probe.mjs main`, two runs at 03:14 and 03:43 UTC, and curl calls from 03:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 2, 3, 4, 5, 6, 7 |
| P2 | `rest-probe.mjs anchor`, two runs at 03:15 and 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs survey`, two runs at 03:33 and 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitrue/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 3, 4 |
