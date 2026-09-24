# CoinW REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 02:38 to 03:10 UTC, from the development host near Seattle.

This profile covers the public futures REST API of CoinW, which has no CCXT class, for both perpetual families.
Every claim below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/coinw/rest-probe.mjs) in two runs about twelve minutes apart, or by [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) where the socket is the only source.
The API reference answered this host, and the help center pages that hold the index, mark and funding formulas returned HTTP 403, see [`fees.md`](./fees.md).

## 1. Host and latency from this machine

| item | run 1 | run 2 |
|---|---|---|
| host | `api.coinw.com`, S1 | |
| addresses | `104.18.20.243`, `104.18.21.243`, `2606:4700::6812:15f3`, `2606:4700::6812:14f3`, Cloudflare | same |
| edge | `cf-ray` suffix `YVR` | `SEA` |
| cold request, new TLS each time, 5 requests of `GET /v1/perpumPublic/ticker?instrument=BTC` | min 209, median 245, max 281 ms | min 214, median 229, max 237 ms |
| warm request, kept-alive, 10 requests | min 174, median 180, max 195 ms | min 191, median 196, max 214 ms |

Almost all of a warm request is time to first byte, so the origin sits well behind the Cloudflare edge.
The WebSocket host is a different CDN, see [`websocket.md`](./websocket.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api.coinw.com/v1/perpum/instruments` with no parameter returns every contract, S2.

| item | value |
|---|---|
| reply | 516,932 bytes, 387 rows, in 291 and 404 ms |
| documented `status` values | `offline`, `online`, `pretest`, `settlement`, `preOffline`, S2 |
| probed `status` | `online` on all 387 |
| by quote | `usdt` 385, `usdc` 2 |
| `name` | upper case base for USDT-M, such as `BTC` and `1000PEPE`, and `BTC_USDC` and `ETH_USDC` for USDC-M |
| `base`, `quote` | lower case, `btc` and `usdt` |
| `oneLotSize` | contract value in base currency, documented as "Minimum contract size (equivalent to Base-size "contract value" on the web interface)". Values seen: 0.0001 on 2, 0.001 on 18, 0.01 on 85, 0.1 on 92, 1 on 118, 10 on 47, 30 on 1, 100 on 17, 1000 on 7 |
| `minSize` | 1 on all 387, documented as contracts |
| `settledPeriod`, `settledAt` | funding interval in hours and next settlement in ms, section 3 |
| `takerFee`, `makerFee` | `"0.0006"` and `"0.0002"` on all 387, see [`fees.md`](./fees.md) section 2 |
| `indexId` | 387 distinct values, one per contract |
| `tradfiTag` | empty on all 387, though equity names such as `SAMSUNG`, `DELL` and `MSTR` are listed |

The batch call `GET /v1/perpum/instrumentList` documents `symbols` as mandatory and at most 20, S3.
Without `symbols` it returned 404 rows in both runs, the 387 plus the 17 `…PROPW` contracts.

The tickers call `GET /v1/perpumPublic/tickers` returned 404 rows in both runs, 402 USDT and 2 USDC.
It spells the contract `BTCUSDT` and `BTCUSDC`, and it holds the 17 `…PROPW` rows that the instruments call does not.
Its `contract_id` is documented as "Contract Type 1: linear perpetuals", S4, but it equalled the instruments `id` on 387 of 387 rows, so `BTC_USDC` reads 148.
Its `contract_size` equalled `oneLotSize` on 387 of 387 rows.

CoinGecko lists 455 CoinW perpetuals, and 70 of them are absent from the instruments reply, mostly equity names such as `AVGO`, `AMAT` and `ARM` last traded days earlier, see [`fees.md`](./fees.md) section 3.
`AVGO` still answered `GET /v1/perpumPublic/depth?base=AVGO` with a book and `GET /v1/perpum/fundingRate?instrument=AVGO` with 0.00021261 settled at 00:00 UTC, while `instruments?name=AVGO` returned an empty list, in both reads of P4.

### How a catalog loader would map it

CCXT 4.5.68 has no CoinW class and CCXT master has none either, see [`fees.md`](./fees.md) section 8.
So the engine's CCXT catalog cannot load CoinW, and a loader has to build the markets from the instruments call.

| engine field | from | note |
|---|---|---|
| `rawMarketId` | `name` | the socket `pairCode`, the depth `base`, the ticker `instrument` and the funding `instrument` all accept it, and the ticker and depth calls also accept it in lower case. The tickers spelling `BTCUSDT` gets an empty list from the ticker call, code 9016 from the depth call, and nothing from the socket |
| `base` | `base` in upper case | keep the `1000` prefix, as CCXT does for Binance's `1000PEPEUSDT`, since `1000PEPE` last traded at 0.0049062 and 0.0049068 against 0.0049054 and 0.0049058 on Binance USD-M, P4 |
| `quote` | `quote` in upper case | USDT and USDC are one settlement family |
| `linear` | true | every contract is margined in its quote |
| `contractSize` | 1 | book sizes arrive in base currency, not in contracts, see [`websocket.md`](./websocket.md) section 4. `oneLotSize` is the order lot and must not become `contractSize` |
| `active` | `status === 'online'` | |
| `taker` | `takerFee` | 0.0006 |

`BTC` and `ETH` are listed twice, against USDT and against USDC, so the quote family picks one of each.
Six contracts carry the `1000` prefix: `1000PEPE`, `1000SHIB`, `1000FLOKI`, `1000SATS`, `1000RATS` and `1000BONK`.
On the 329 USDT contracts that Binance USD-M also lists, the last price sat a median 239 and 267 ppm from Binance's, at most 16,861 ppm, and none beyond 5 %, P4.
So no contract needs a price scale against Binance.
`ANTHROPIC` read 2,112.52 and 2,115.70 against 2,117.54, so it is quoted per unit, unlike OKX's per-10 contract.

## 3. Anchor

### The bulk calls

No REST call returns the index, the mark and the upcoming funding rate for all contracts.

| call | index | mark | funding rate | interval | next settlement | reply | time over 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /v1/perpum/instruments` | absent | absent | absent. `settlementRate`, documented as "Overnight fee rate", was 0.0004 on 364 contracts and is not the funding rate | `settledPeriod`, hours | `settledAt`, Unix ms | 516,932 bytes, 387 rows | min 210 and 214, median 225 and 224, p90 470 and 251, max 722 and 431 ms |
| `GET /v1/perpumPublic/tickers` | `fair_price` is documented as "Index price of the contract", S4, and it tracks the last price instead, section 4 | absent | absent | absent | absent | 108.6 to 108.8 KB, 404 rows | min 486 and 515, median 587 and 578, p90 731 and 675, max 855 and 951 ms |
| `GET /v1/perpum/fundingRate?instrument=BTC` | | | the last settled rate only, per contract, documented at 8 a second | | the last settlement, not the next | 78 to 81 bytes | 177 to 460 ms per request, P5 |
| socket `index_price`, `mark_price`, `funding_rate` per contract | `p` | `p` | `r` | `h`, hours | `nt`, Unix ms | 127 to 158 bytes a frame | every 245 to 320 ms, 238 to 306 ms and 5 s |

So the anchor has to come from the socket, which carries all five `AnchorRow` fields, see [`websocket.md`](./websocket.md) section 2.
The funding frame's `h` equalled `settledPeriod` and its `nt` equalled `settledAt` on all 171 contracts compared in each run, P3.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `pairCode` of the frame | lower case, `btc` and `btc_usdc` | upper case to the `rawMarketId` |
| `index` | `index_price` `data.p` | JSON number | none |
| `mark` | `mark_price` `data.p` | JSON number, never 0 on 171 contracts | none |
| `fundingRate` | `funding_rate` `data.r` | JSON number, a fraction per interval: `0.00003788` is 0.003788 % | none |
| `fundingIntervalHours` | `funding_rate` `data.h` | integer hours, 8, 4 or 1 | none |
| `nextFundingAt` | `funding_rate` `data.nt` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

At 02:43 UTC the 211 contracts on 8 h read 08:00 UTC, the 175 on 4 h read 04:00 UTC, and `G`, the one hourly contract, read 03:00 UTC.
`settledAt` did not change over either 60 s poll, since no settlement fell inside them.

## 4. Anchor semantics

### Index

The API reference gives no index formula and no basket call.
The help center article on the mark price returned 403, and its search result snippet says the index is "based on prices from a basket of major spot trading markets including Binance, HTX, OKX, Bybit, Gate.io, and Kucoin", S5.
The same snippet describes a guard: a source more than 5 % from the median of all sources gets weight zero, and if more than one source deviates by more than 5 %, the index becomes the median of all sources.
That is a search snippet of a page this host could not read, so it is Not verified.

Against Binance USD-M `premiumIndex` read right after a 20 s hold, P3:

| comparison over 165 contracts listed on both | run 1 | run 2 |
|---|---|---|
| index within 10 ppm | 11 | 4 |
| index difference, median, p90, max | 260, 1,076, 121,608 ppm | 300, 1,177, 126,826 ppm |
| mark within 10 ppm | 28 | 16 |
| mark difference, median, p90, max | 166, 845, 16,169 ppm | 162, 813, 2,902 ppm |

So the index is not a copy of Binance's index.
The largest gap is `ONE`, whose Binance index is Binance's own perpetual, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).

### Mark

The help center snippet names a "Moving Average (30-minute Basis)" of "((Bid1+Ask1)/2 - Price Index) every minute for 30 minutes", S5, which reads as index plus a 30 minute moving basis.
No clamp is published anywhere this host or the fetch tool could read, so the cap is Not verified.

| mark minus index over 171 contracts | run 1 | run 2 |
|---|---|---|
| absolute, median, p90 | 362, 1,288 ppm | 360, 1,394 ppm |
| mark equal to index | 34 contracts | 36 contracts |
| beyond 5,000 ppm | `ONE` at -106,471 ppm | `ONE` at -122,302 ppm |

A mark 12 % under its index means that no tight premium clamp applied to `ONE`.
On the six contracts watched for 45 s, `BTC` held a mark 351 to 509 ppm under its index, `ETH` 207 to 471 ppm under, and `G` 2,805 to 3,300 ppm under in the second run, P2.

The tickers `fair_price` is not the index the documentation names.
It equalled the socket index on 0 of 90 polls of `BTC` and of `ETH`, equalled the socket mark on 32 and 34 of 45 `BTC` polls, and equalled the ticker's own `last_price` on 39 and 41, P2.
It matched the index only where index and mark coincided, 7 and 11 of 45 polls on `DOGE` and 0 and 2 on `TRB`.
Across all rows it equalled `last_price` on 21,213 and 21,383 of 24,240 row readings, P1 anchor.

### Funding

The funding article returned 403, and its search snippet gives only the fee, "Position Notional Value × Current Funding Rate", S6.
The formula, the cap and the floor are Not verified.

The socket's `r` is the upcoming rate, not the settled one.
`BTC` read `r` 0.00003788 while `fundingRate` returned the rate settled at 00:00 UTC, 0.00001021, P1 funding and P2.
On 164 of 165 contracts that Binance USD-M also lists, `r` equalled Binance's `lastFundingRate` exactly, in both runs, P3.
So CoinW publishes Binance's current funding rate for almost every shared contract, which is an observation and not a documented rule.
The lowest `r` over 171 contracts was -0.004099 and -0.004149 on `ONE`, 4 h, and the highest 0.00056839 and 0.00055309 on `ARC`, 4 h, P3.

`GET /v1/perpum/fundingRate?instrument=BTC_USDC`, the spelling the documentation gives for USDC contracts, returned `{"code":9001,"msg":"Contract not found."}` in both runs, while the socket served `funding_rate` for `btc_usdc`.

### Rate across a settlement

Not captured.
The survey does not wait for a settlement instant.
The REST `fundingRate` reply shows the last settlement at 00:00 UTC for 8 h and 4 h contracts and at 02:00 UTC for the hourly `G`, consistent with `settledAt` minus `settledPeriod` on the five contracts it answered, P1 funding.
A read at 03:07 UTC, after `G` settled at 03:00, returned -0.000411 settled at 03:00 and a `settledAt` of 04:00, P5.
The socket had read `r` -0.000379 for `G` at 02:46 and -0.000407 at 02:56, so the settled rate was close to the last rate published before it, P2.
The Precautions page says orders and closes are refused while funding runs, typically 30 to 40 s, S7.

### How often each number changed

Over 45 s of socket frames on six contracts, P2, in the first and second run:

| contract | index frames and changes | mark frames and changes | `r` frames and changes |
|---|---|---|---|
| `BTC` | 151, 90, and 151, 71 | 150, 46, and 151, 26 | 9, 1, and 9, 0 |
| `ETH` | 146, 110, and 151, 105 | 146, 78, and 151, 65 | 9, 0, and 9, 0 |
| `BTC_USDC` | 142, 63, and 146, 41 | 142, 61, and 146, 51 | 9, 8, and 9, 8 |
| `G` | 149, 0, and 140, 38 | 149, 0, and 139, 34 | 9, 1, and 9, 1 |
| `DOGE` | 143, 85, and 144, 96 | 143, 76, and 144, 80 | 9, 0, and 9, 0 |
| `TRB` | 150, 3, and 151, 9 | 150, 8, and 150, 10 | 9, 0, and 9, 0 |

The index and mark therefore move several times a second on a busy contract, and `G` held both still for 45 s in the first run.
The tickers `fair_price` of `BTCUSDT` changed on only 10 and 7 of 59 one-second polls, P1 anchor.

## 5. REST book snapshot

`GET /v1/perpumPublic/depth?base=BTC`, S8.

| item | value |
|---|---|
| depth | 20 levels per side, fixed, documented and probed on `BTC`, `ETH`, `BTC_USDC` and `AINVDA` |
| order | bids descending, asks ascending |
| numbers | JSON numbers, `{"m": 1.051, "p": 86450.4}` |
| keys | `asks`, `bids`, `n`, `t`, where the documentation says `ts` |
| size unit | base currency, documented as "Quantity of the base currency" |
| time | 178 to 238 ms per request |
| age | `t` was 93, 162 and 169 ms older than arrival on three contracts and 1,150 ms on `BTC` in the second run |
| caching | a second read 175 to 189 ms later differed on `BTC`, `ETH` and `AINVDA`, and was identical on `BTC_USDC` in the second run |
| touch against Binance | the `BTC` best bid equalled Binance USD-M's best bid on 6 of 6 reads, and the best ask on 2 of 6, P4 |
| limit | 10 requests per 2 s per user and IP, S8 |

## 6. Rate limits and errors

| scope | limit | source |
|---|---|---|
| `instruments`, `tickers`, `ticker` | 5 a second per user and IP | S2, S4 |
| `instrumentList` | 2 a second per user and IP | S3 |
| `fundingRate` | 8 a second per user and IP | S9 |
| `depth` | 10 per 2 s per user and IP | S8 |
| group A: `klines`, `tickers`, `ticker`, `trades`, `depth` | 30 a second per IP combined | S7 |
| group B: every other futures call | 100 a second per user | S7 |
| refusal | `{"code": 29001,"msg": "API access frequently"}` | S7 |
| escalation | more than 80 limit errors per IP in 10 s starts a 5 minute warning phase at half the limits. Breaching it again bans all API access for 30 s. Ten bans per IP in 8 h blacklist the IP for 8 h | S7 |

No limit was reached, so the HTTP status of a 29001 refusal and any `Retry-After` header are Not verified.
The probes together sent at most about 3 requests a second.

Error shapes, the same in both runs:

| request | HTTP | body |
|---|---|---|
| `instruments?name=NOPE` | 200 | `{"code":0,"data":[],"msg":""}` |
| `ticker?instrument=NOPE` and `ticker?instrument=BTCUSDT` | 200 | `code` 0 and an empty list |
| `ticker` with no parameter | 400 | `{"code":904,"msg":"Method parameters verification failed"}` |
| `depth?base=NOPE` and `depth?base=BTCUSDT` | 200 | `{"code":9016,"data":null,"msg":"Incorrect parameter format/type or missing information."}` |
| `depth` with no parameter | 400 | `code` 904 |
| `fundingRate?instrument=NOPE` and `fundingRate?instrument=BTC_USDC` | 200 | `{"code":9001,"msg":"Contract not found."}` |
| `fundingRate` with no parameter | 400 | `code` 904 |
| an unknown path | 404 | `{"code":404,"msg":"Requested address does not exist"}` |

A client must read `code`, since most refusals arrive with HTTP 200.
`ticker?instrument=btc` and `depth?base=btc` work, so the calls are case-insensitive.

## 7. Server time and clock offset

The futures API documents no server time call.
The `Date` header, which has one second resolution, read 865 ms behind to 28 ms ahead of the local clock in the first run and 810 ms behind to 81 ms ahead in the second, which only says the clocks agree within a second.
The newest `ts` in a tickers reply was 154 to 475 ms and 122 to 353 ms older than its arrival.
The socket is the better clock: an `index_price` frame's `t` was 95 to 154 ms older than its arrival, on a host whose clock is NTP synchronised, P2.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The engine's anchor is a REST poller, and CoinW has no REST call that fills it, so the recommendation is a named change.

| item | recommendation | reason |
|---|---|---|
| source | a socket anchor: `index_price`, `mark_price` and `funding_rate` subscribed for every tracked contract on `wss://ws.futurescw.com/perpum`, with the poller's `fetchRound` returning the latest value of each | no REST call carries the mark or the upcoming rate, section 3 |
| contracts per connection | 150, which is 450 subscriptions | on one connection the first 513 subscriptions delivered and the rest were acknowledged and silent, in both runs, P3 |
| subscribe pacing | 25 frames a second | no limit is documented for these channels, and 25 a second drew no refusal |
| keepalive | `{"event": "ping"}` every 20 s | the same session rules as the book feed, see [`websocket.md`](./websocket.md) section 5 |
| row mapping | section 3, key the upper case `pairCode` | |
| freshness | a value older than 2 s is stale | index and mark push every 238 to 320 ms at the median and at most 1,302 ms apart in these runs, so a 2 s gap is a dead stream |
| catalog refresh | `GET /v1/perpum/instruments` every 60 s, for status and listings | 516,932 bytes, 5 a second allowed |
| rate limit pause | `rateLimitPauseMs` 30,000 | a ban lasts 30 s, S7, and whether a refusal carries `Retry-After` is Not verified |
| skip | rows whose `status` is not `online`, the `…PROPW` rows, and contracts absent from the instruments reply | the last two are not in the public catalog |
| do not read | tickers `fair_price` as an index | it tracks the last price, section 4 |
| deny list input | `ONE`, whose mark sat 10.6 % and 12.2 % under its index, which the `ONE` line of `DENIED_PAIRS` already covers | section 4 |

The REST fallback would be `fundingRate` per contract for the last settled rate and `tickers` for a last price, and it cannot supply a mark, so it cannot fill the row.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinW API, Futures Trading base URL | https://www.coinw.com/api-doc/en/common/futures-trade-information | 2026-09-22 | CoinW, global | host, section 1 |
| S2 | CoinW API, Get Instrument Info | https://www.coinw.com/api-doc/en/futures-trading/market/get-instrument-information | 2026-09-22 | CoinW, global | fields, statuses, limit, sections 2 and 6 |
| S3 | CoinW API, Get Batch Instrument Info | https://www.coinw.com/api-doc/en/futures-trading/market/get-batch-instrument-information | 2026-09-22 | CoinW, global | `symbols` at most 20, field meanings, sections 2 and 6 |
| S4 | CoinW API, Get Last Trade Summary of All Instruments | https://www.coinw.com/api-doc/en/futures-trading/market/get-last-trade-summary-of-all-instruments | 2026-09-22 | CoinW, global | `fair_price`, `contract_id`, limit, sections 2, 3 and 6 |
| S5 | "Mark Price in USDT-Margined Futures", search result snippet | https://coinw.zendesk.com/hc/en-us/articles/4408132244121-Mark-Price-in-USDT-Margined-Futures | 2026-09-22, page HTTP 403 | CoinW | index basket, deviation guard, mark basis, section 4 |
| S6 | "Introduction to CoinW Futures Funding Rates", search result snippet | https://coinw.zendesk.com/hc/en-us/articles/22097751078169-Introduction-to-CoinW-Futures-Funding-Rates | 2026-09-22, page HTTP 403 | CoinW | funding fee, section 4 |
| S7 | CoinW API, Precautions | https://www.coinw.com/api-doc/en/common/precautions | 2026-09-22 | CoinW, global | global limits, escalation, funding halt, sections 4 and 6 |
| S8 | CoinW API, Get Order Book | https://www.coinw.com/api-doc/en/futures-trading/market/get-order-book-of-an-instrument | 2026-09-22 | CoinW, global | 20 levels, base currency, limit, section 5 |
| S9 | CoinW API, Get Last Settlement Funding Fee Rate | https://www.coinw.com/api-doc/en/futures-trading/market/get-last-settelment-funding-fee-rate | 2026-09-22 | CoinW, global | last settled rate, 8 a second, `9001`, sections 3 and 6 |
| S10 | Binance USD-M `premiumIndex`, `ticker/price` and `depth` | https://fapi.binance.com/fapi/v1/premiumIndex | 2026-09-23 UTC | Binance | comparisons, sections 2, 4 and 5 |
| P1 | `rest-probe.mjs` every mode, run 1 at 02:43 to 02:45 UTC and run 2 at 02:55 to 02:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinw/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `ws-probe.mjs anchor`, at 02:46 and 02:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 7 |
| P3 | `ws-probe.mjs anchorbatch` and `cap`, at 02:50 to 02:52 and 02:57 to 02:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 8 |
| P5 | `rest-probe.mjs funding` at 03:07 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinw/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 4 |
| P4 | `rest-probe.mjs binance` and `errors`, twice at 03:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinw/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2 and 5 |
