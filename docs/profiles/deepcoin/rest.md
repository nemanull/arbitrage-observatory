# Deepcoin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 between 03:15 and 03:48 UTC, from the development host near Seattle.

This profile covers the public REST API of Deepcoin (CCXT id `deepcoin`) that a catalog, an anchor poller and a book resync would use, for both perpetual families.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs), run from `server/`, unless it names [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs).
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST host | `https://api.deepcoin.com`, CCXT `urls.api` at `server/node_modules/ccxt/js/src/deepcoin.js` lines 143 to 146 |
| resolution | CNAME `dbbrf7g4gn9af.cloudfront.net`, four addresses in `108.138.94.0/24` |
| edge | CloudFront POP `SEA73-P2`, `x-cache: Miss from cloudfront` on every market call |
| cold request | 255 and 276 ms to `GET /deepcoin/market/time` in the two `catalog` runs |
| warm request | 174 to 221 ms over ten requests |
| web site and docs | `www.deepcoin.com` answered 403 "Request blocked" from CloudFront, see [`fees.md`](./fees.md) section 1 |

The venue's own servers sit behind CloudFront, so the round trip is to the Seattle edge and the edge's fetch from the origin.

## 2. Catalog

### The instruments call

`GET /deepcoin/market/instruments?instType=SWAP` returns every perpetual in one reply of 94 KB, with no paging.

| settlement | contracts | `ctVal` values | state |
|---|---:|---|---|
| USDT, linear | 348 | 176 at 1, 159 at 0.1, 7 at 0.01, 3 at 1000, 2 at 100, 1 at 0.001 | all `live` |
| USD, inverse, settled in the base coin | 5 | 3 at 1, 2 at 10 | all `live` |

`instType=SPOT` returns 173 spot pairs, all `live`.
The instruments reply carries no index, mark, funding or fee field, and `ctValCcy`, `ctType`, `alias` and `uly` were empty on every row.

### How CCXT 4.5.68 maps it

| CCXT field | source | probed on 353 swaps |
|---|---|---|
| `id` | `instId`, such as `BTC-USDT-SWAP`, `deepcoin.js` line 492 | 353 of 353 |
| `linear` | `quoteId !== 'USD'`, line 505 | 348 linear, 5 inverse |
| `active` | `state === 'live'`, line 534 | 353 of 353 |
| `contractSize` | `ctVal`, line 538 | 353 of 353 equal `ctVal` |
| `taker`, `maker` | the one `trading` pair, lines 221, 222 and 510 | 0.0015 and 0.001 on 353 of 353 |

`loadMarkets` fetched 525 markets in 526 and 619 ms, 353 of them swaps.

### Identifiers across the three spellings

| where | spelling for the BTC perpetual |
|---|---|
| CCXT `market.id`, instruments, mark price, tickers, REST book | `BTC-USDT-SWAP` |
| socket `FilterValue` and `I`, funding rate, funding cycle, funding history | `BTCUSDT` |

The compact form is `market.id` without `-SWAP` and without its first dash, and it was unique over all 353 swaps.
CCXT registers that compact form as a second id for each swap at `deepcoin.js` line 576, so its own funding calls resolve.
The socket book needs one more piece, the tick size, as the string `info.tickSz`, see [`websocket.md`](./websocket.md) section 4.

### Size unit, pairs listed twice, and price scale

- One contract is `ctVal` coins, and the socket reports contracts, so CCXT's `contractSize` is the right multiplier, see [`websocket.md`](./websocket.md) section 4.
  The REST book instead reports coins, section 5.
- Five bases have both a USDT linear and a USD inverse contract: `LTC`, `ETH`, `XRP`, `BCH` and `LINK`.
  USD and USDT are one settlement family, so a `marketFilter` has to keep the USDT contract, whose ids and units match the other 343.
- Four bases carry a 1000 prefix, `1000BONK`, `1000CAT`, `1000PEPE` and the one of `1000CHEEMS-USDT-SWAP`, whose venue `baseCcy` is truncated to `1000CHEE`.
  CCXT copies that into `base`, so the CHEEMS contract will not cluster with `1000CHEEMS` on other venues without an override.
  `1000PEPE-USDT-SWAP` has `ctVal` 1000, so one contract is 1,000 units of `1000PEPE`.
- The ticker and mark replies carry 7 instruments the catalog does not list: `1BTC-USD-SWAP`, `1ETH-USD-SWAP`, `1XRP-USD-SWAP`, `2BTC-USDT-SWAP`, `2ETH-USDT-SWAP`, `dBTC-USDT-SWAP` and `dETH-USDT-SWAP`.
  Their 24 h quote volumes read from 570 to 78,132,071,265 on the second pass, and at 03:16 UTC `dETH-USDT-SWAP` alone was about 89 % of the USDT quote volume in the ticker reply.
  They never reach CCXT, since `loadMarkets` reads only the instruments call.
- Stock and RWA perpetuals follow US market hours, with the price frozen while the market is closed, [`fees.md`](./fees.md) section 7.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /deepcoin/market/mark-price?instType=SWAP` | absent | `markPx` | absent | absent | absent | 30.6 KB, 360 rows | 60 polls: median 244 and 249 ms, max 345 and 369 ms |
| `GET /deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU` | absent | absent | `fundingRate` | absent | absent | 30.3 KB, 598 rows | 60 polls: median 217 and 221 ms, max 259 and 289 ms |
| `GET /deepcoin/trade/funding-rate?instType=SwapU` | absent | absent | absent | `settleInterval` | `nextSettleTime` | 27.5 KB, 348 rows | 210 and 377 ms |
| `GET /deepcoin/market/tickers?instType=SWAP` | absent | absent | absent | absent | absent | 104 KB, 360 rows | 290 and 447 ms |
| the same two funding calls with `instType=Swap` | | | the 5 inverse contracts | 14400 on all 5 | | 313 and 416 bytes | about 200 ms |

No REST call returns a live index.
`GET /deepcoin/market/index-candles?instId=…&bar=1m` is per instrument, and its newest row was the last completed minute: at 03:42:09 UTC it opened at 03:41:00.
Over 30 reads two seconds apart its close changed 1 and 3 times on BTC, so it lags by up to a minute and costs one call per contract.
The index is published only on the socket, as `D` in the TopicID 7 ticker, see [`websocket.md`](./websocket.md) section 2.
The documented path of the rate call, `/deepcoin/market/fund-rate/current-funding-rate` in S4, answered 404 `Not Found`, and the working path is `/deepcoin/trade/…` as in S8 and CCXT.

### Coverage and keys

| call | rows | USDT contracts covered | key | extra rows |
|---|---:|---|---|---|
| mark price | 360 | 348 of 348 | `instId`, `BTC-USDT-SWAP` | the 7 hidden instruments |
| current funding rate | 598 | 348 of 348 | `instrumentId`, `BTCUSDT` | 250 names that are not listed, such as `BTCUSDC`, `BDXUSDT` at -0.025 and `ETHUSD` |
| funding cycle | 348 | 348 of 348 | `instrumentID`, `BTCUSDT` | none |

An unknown `instId` on the rate call returns `{"code":"0","msg":"","data":{"current_fund_rates":[{"instrumentId":"NOPEUSDT","fundingRate":0}]}}`, so a poller must key rows by the catalog, since a name the venue does not know reads as a rate of 0.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instId` of mark price, `instrumentId` and `instrumentID` of the funding calls | strings in two spellings | map both to `rawMarketId` through the catalog |
| `index` | `D` of the TopicID 7 ticker | JSON number | none, and no REST source |
| `mark` | `markPx` | decimal string, never 0 on 360 rows | `Number()` |
| `fundingRate` | `fundingRate` | JSON number, a fraction per interval | none |
| `fundingIntervalHours` | `settleInterval` | integer seconds: 28800, 14400, 3600 | divide by 3,600 |
| `nextFundingAt` | `nextSettleTime` | integer Unix seconds: `1790150400` is 2026-09-23 08:00 UTC | multiply by 1,000 |

At 03:34 and 03:42 UTC, 201 contracts read an 8 h interval with next settlement 08:00 UTC, 146 read 4 h with 04:00 UTC, and `CVCUSDT` read 1 h with 04:00 UTC.
Mark rows carry `ts`, in whole seconds.
At arrival a row's `ts` was a median of 500 and 1,262 ms old, and at most 4,503 and 5,269 ms old, over 240 readings in each `poll` run.

## 4. Anchor semantics

### Index

"It is calculated by selecting the spot prices of more than three mainstream exchanges as the weight component.", H10.
The constituents and weights are Not publicly specified, and no basket call was found.
So whether any index includes Deepcoin's own market cannot be checked, which is the shape [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) describes.
For stock and RWA perpetuals the price freezes while the US market is closed, H12.
`D` sat about 480 ppm above the mark on BTC and up to about 2,100 ppm away on the thinner contracts, in either direction, during the `book` runs, so it is a separate series and not the mark renamed.

### Mark

"Basis moving average = moving average ((contract selling price + contract buying price)/2-spot index price)" and "Mark price = Spot index price + basis moving average", H10.
The window of the moving average is Not publicly specified.
No clamp on the basis is documented, so a capped mark of the kind that reads a capped leg as fresh is not expected, and it was not tested.

### Funding

The formula and the cap are in [`fees.md`](./fees.md) section 6: `F = P + clamp(I - P, 0.05%, -0.05%)`, capped at `(initial margin - maintenance margin) * 75%`, H9.
The rate is per interval.
On the second pass 99 contracts on 8 h read exactly 0.0001 and 57 on 4 h read exactly 0.00005, which are the same daily rate.
The live extremes were `KERNELUSDT` at -0.005721 and `KSTRUSDT` at 0.001273 on the second pass.

### Upcoming or settled

The published rate is the upcoming one.
BTC read -0.00012264 at 03:42 UTC while its last settled rate, at 00:00 UTC, was -0.0001593, and `TMFUSDT` read 0.000461 against a settled -0.000051.
The TopicID 7 field `E`, documented as "Previous position fee rate", equalled this upcoming rate on 12 of 12 reads, see [`websocket.md`](./websocket.md) section 2.

### Rate across a settlement

The settlement instant itself was not captured.
`GET /deepcoin/trade/fund-rate/history?instId=BTCUSDT` returned 20 rows whose `CreateTime` falls exactly on 00:00, 08:00 and 16:00 UTC for BTC, and a `curl` read of the 1 h `CVCUSDT` showed rows on every hour.
The documentation names the array `list` and the field `ratePeriodSec` as the cycle, S10, while the wire names the array `rows` and sends `ratePeriodSec` 0 on every row.
The `size` parameter was ignored, since `size=6` returned 20 rows.

### How often each number changed

Two `poll` runs of 60 reads one second apart, at 03:35 and 03:42 UTC.

| contract | mark changes of 59 | mark `ts` changes of 59 | rate changes of 59 |
|---|---|---|---|
| `BTC-USDT-SWAP` | 35 and 53 | 46 and 59 | 1 and 0 |
| `ETH-USDT-SWAP` | 36 and 56 | 45 and 59 | 1 and 0 |
| `AXTI-USDT-SWAP` | 14 and 6 | 43 and 47 | 0 and 0 |
| `TMF-USDT-SWAP` | 1 and 10 | 37 and 32 | 1 and 0 |

Over all 360 mark rows, 3,922 and 4,620 of 21,240 row readings changed from the previous poll.
The rate moved at most once a minute, which fits the per minute premium index of H9.
The socket's `M` and `D` moved more often: 59 to 63 distinct marks and 72 to 79 distinct indexes on BTC in 60 s, [`websocket.md`](./websocket.md) section 2.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /deepcoin/market/books?instId=BTC-USDT-SWAP&sz=20` |
| depth | `sz` from 1 to 400 and required. `sz=401` answered ``{"code":"51","msg":"The Size value `401` must be between 1 and 400","data":null}``, and no `sz` answered `The Size field is required` |
| reply | `sz=400` gave 400 bids and 233 to 235 asks in 11.7 KB, in about 205 ms |
| level order | bids descending, asks ascending, on every read |
| numbers | price and size as strings |
| size unit | coins, which is the socket's contract count times `ctVal` on 20 of 20 levels per side in 24 reads, [`websocket.md`](./websocket.md) section 4 |
| caching | six reads 150 ms apart all showed `x-cache: Miss from cloudfront` and no `age` header, and the touch size changed between reads |

The ticker call reports `bidSz` and `askSz` in contracts, as the CCXT comment at `deepcoin.js` line 757 shows with `"bidSz": "63220"` for `BTC-USD-SWAP`, while the book reports coins.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| documented limit | 10 requests per second and 600 per minute per IP for instruments, tickers, mark price candles, index candles, funding rate, funding history and time, and 50 per second and 600 per minute for the book | S4 |
| headers on the wire | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-window: 1s` and `x-ratelimit-reset` in ms | probed |
| limit per call on the wire | 10 on mark price, funding cycle, tickers and instruments. 50 on the current funding rate and the book | probed, `x-ratelimit-limit` |
| CCXT | `rateLimit: 200`, and the funding calls cost 5 | `deepcoin.js` lines 24 and 165 to 167 |
| over the limit | status and `Retry-After` Not verified, since no probe went near the limit | |
| error shape | HTTP 200 with a non-zero `code`: `{"code":"50","msg":"contract symbol(NOPEUSDT) not found","data":null}`, `{"code":"51","msg":"The instType field is required","data":null}`, ``{"code":"51","msg":"The instType value `FUTURES` is not in acceptable range: SWAP","data":null}`` | probed, `misc` |
| unknown path | HTTP 404 with the body `Not Found` and `x-cache: Error from cloudfront` | probed |

A poller must check `code` and not only the HTTP status.
A 1 s poll of the mark and rate calls spends 60 of the 600 per minute on each path.

## 7. Server time and clock offset

`GET /deepcoin/market/time` returns `{"code":"0","msg":"","data":{"ts":1790133323379}}` in ms.
Against the midpoint of each request the server read 6 ms ahead of this host in both `misc` runs, over ten samples from -1 to +22 ms with round trips of 190 to 219 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| mark | `GET /deepcoin/market/mark-price?instType=SWAP` every 1,000 ms | one call, median 244 to 249 ms, 10 per second allowed |
| funding rate | `GET /deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU` every 1,000 ms, or every 10 s | it moves at most once a minute |
| interval and next settlement | `GET /deepcoin/trade/funding-rate?instType=SwapU` every 60 s and right after each `nextSettleTime` | 348 rows, changes only at a settlement |
| index | the TopicID 7 ticker `D`, one stream per contract on the book sockets | no REST call returns a live index, which is the change this venue needs, since `AnchorPoller` is REST only |
| alternative | the whole row from TopicID 7: `M`, `D`, `E` and `PF`, with the interval from the funding cycle call | `M`, `E` and `PF` matched REST on 35 of 36 reads in the second `book` run, and a quiet ticker still sent a frame every 5 s |
| row mapping | section 3 | two key spellings |
| skip | rate rows not in the catalog, and the 7 hidden instruments | 250 dead rows, some with extreme rates |
| skip | the 5 inverse contracts through `marketFilter` | they duplicate USDT pairs |
| watch | stock and RWA perpetuals outside US market hours | their price is frozen, H12 |
| rate limit pause | `rateLimitPauseMs` 1,000 | the window is 1 s, and no `Retry-After` was observed |

The mark rows carry a `ts` up to about 5 s old at arrival, so a poller that stamps on arrival reports them fresher than they are, and stamping with `ts` would be the stricter choice.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S4 | Deepcoin API, Rate Limit Rules | https://www.deepcoin.com/docs/rateLimit | 2026-09-22, through the fetch | Deepcoin, global | limits and the documented rate path, sections 3 and 6 |
| S6 | Deepcoin API, Get Order Book | https://www.deepcoin.com/docs/DeepCoinMarket/marketBooks | 2026-09-22, through the fetch | Deepcoin, global | `sz` maximum 400, section 5 |
| S7 | Deepcoin API, Get Mark Price, added 2026-06-11 | https://www.deepcoin.com/docs/DeepCoinMarket/getMarkPrice | 2026-09-22, through the fetch | Deepcoin, global | mark call, section 3 |
| S8 | Deepcoin API, Current Funding Rate | https://www.deepcoin.com/docs/DeepCoinTrade/currentFundRate | 2026-09-22, through the fetch | Deepcoin, global | rate call, `SwapU` and `Swap`, section 3 |
| S9 | Deepcoin API, Funding Rate | https://www.deepcoin.com/docs/DeepCoinTrade/fundingRate | 2026-09-22, through the fetch | Deepcoin, global | `settleInterval`, `nextSettleTime`, section 3 |
| S10 | Deepcoin API, Funding Rate History | https://www.deepcoin.com/docs/DeepCoinTrade/fundingRateHistory | 2026-09-22, through the fetch | Deepcoin, global | documented `list` and `ratePeriodSec`, section 4 |
| S12 | Deepcoin API, Get Market Tickers | https://www.deepcoin.com/docs/DeepCoinMarket/getMarketTickers | 2026-09-22, through the fetch | Deepcoin, global | ticker fields without mark or index, section 3 |
| H9 | Funding Costs of USDT Perpetual Pro Contract | https://deepcoin.zendesk.com/hc/en-001/articles/360056527671-Funding-Costs-of-USDT-Perpetual-Pro-Contract | 2026-09-22 | Deepcoin, global | funding formula and cadence, section 4 |
| H10 | Latest Transaction Price, Index Price and Mark Price, edited 2023-12-21 | https://deepcoin.zendesk.com/hc/en-001/articles/360050501452-Latest-Transaction-Price-Index-Price-and-Mark-Price | 2026-09-22 | Deepcoin, global | index and mark formulas, section 4 |
| H12 | Important Update: RWA Index Perpetual Contracts Trading Hours & Risk Management Adjustments | https://deepcoin.zendesk.com/hc/en-001/articles/51027537396761-Important-Update-RWA-Index-Perpetual-Contracts-Trading-Hours-Risk-Management-Adjustments | 2026-09-22 | Deepcoin, global | frozen prices, sections 2, 4 and 8 |
| X1 | CCXT 4.5.68 `deepcoin.js` | `server/node_modules/ccxt/js/src/deepcoin.js` | 2026-09-22 | CCXT | market mapping, second id, fees, rate limit, sections 1, 2, 5 and 6 |
| P1 | `rest-probe.mjs catalog`, at 03:34 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 2 |
| P2 | `rest-probe.mjs anchor`, at 03:34 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs poll`, at 03:35 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs book` and `misc`, at 03:40 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deepcoin/rest-probe.mjs) | 2026-09-22 | this host | sections 5 to 7 |
| P5 | `ws-probe.mjs book`, at 03:22 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs) | 2026-09-22 | this host | the socket against REST, sections 4 and 5 |
| P6 | `curl` and `dig` at 03:15 UTC | | 2026-09-22 | this host | section 1 |
