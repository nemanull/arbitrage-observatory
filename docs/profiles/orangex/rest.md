# OrangeX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:18 to 03:53 UTC, from the development host near Seattle.

This profile covers the public REST API of OrangeX for the USDT-margined perpetuals, its only perpetual family.
OrangeX has no CCXT class, so there is no CCXT mapping to check, and section 2 describes what a catalog loader would have to build instead.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) unless a source id says otherwise.
The documentation, S1, is a JSON-RPC API in the Deribit shape whose examples date from 2020, and several of the calls this profile relies on are not in it.
Those calls are marked undocumented, and they were found in the website's own bundle, S4.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.orangex.com`, base path `/api/v1/public`, S1 |
| resolved address | `34.111.170.13`, one address, in all three catalog runs |
| front | Google, every reply carries `via: 1.1 google` and `alt-svc: h3` |
| small call, `tickers?instrument_name=BTC-USDT-PERPETUAL` | cold 229 to 233 ms, warm 143 to 498 ms with a median of 148 ms over five, in three runs |
| status | HTTP 200 on every call, errors included, see section 6 |
| encoding | gzip JSON |

## 2. Catalog

### The instruments call

`GET /api/v1/public/get_instruments?currency=PERPETUAL` returned 578 rows in 403,563 bytes, in 193 and 256 ms in two runs.

| field | value on the wire |
|---|---|
| `instrument_name` | `BTC-USDT-PERPETUAL`, the id the socket, the ticker and the funding calls all use |
| `kind` | `perpetual` on 578 |
| `is_active` | `true` on 578, the only status field |
| `base_currency` | `USDT` on 578, which is the settlement asset |
| `quote_currency` | the coin, `BTC` for `BTC-USDT-PERPETUAL` |
| `show_name` | the coin plus `USDT` on 578 of 578 |
| `contract_size` | absent on all 578, although S1 lists it |
| `min_trade_amount`, `min_qty` | `"0.001"` BTC on `BTC-USDT-PERPETUAL` |
| `taker_commission`, `maker_commission` | see [`fees.md`](./fees.md) section 2 |
| `creation_timestamp` | ms, and in the future on a contract not yet listed |
| `obDepth` | 100 on all 578 |
| `leverage` | 20 to 200 |
| `newListing` | `false` on 578 |

`base_currency` and `quote_currency` are swapped against their usual meaning, and S1's spot example shows the same swap.
`get_instruments` with no parameter returned all 936 instruments: 578 perpetual, 348 spot and 10 `sandbox`, the demo contracts.
`currency=SPOT` returned 348 and `currency=SANDBOX` returned 10.
`currency=NOPE` returned `"result":[]` with no error.
S1 still documents the currencies `BTC`, `ETH` and `SPOT` and the kinds `margin`, `spot`, `option` and `future`, and the catalog holds no margin, option or future.

### Status values

There is no status string, only `is_active`.
`OURA-USDT-PERPETUAL` was in the catalog at 03:25 UTC with `is_active` true and a `creation_timestamp` of 03:30 UTC, and it was absent from `tickers` and `cmc_contracts` until then.
So `is_active` does not mean listed, and a loader must also require `creation_timestamp` to be in the past.
Sixteen contracts carry a non-zero `close_only_limit_value`, whose meaning is Not publicly specified.

### The ids across calls

| call | rows | in the catalog | not in the catalog |
|---|---:|---:|---:|
| `tickers?currency=PERPETUAL` | 577 at 03:25, 578 at 03:45 | all | 0 |
| `cmc_contracts` | 577 at 03:25, 578 at 03:45 | all | 0 |
| `get_all_capital_rate` | 769 | 578 | 191 |
| socket `book.{id}.raw` | 578 subscribed | 578 delivered | |

The 191 extra funding rows are old contracts, whose `currentTime` runs from 2025-03-18 to the day of the probe.
One of them, `BLAST-USDT-PERPETUAL`, still had a current `currentTime` at 03:27 and at 03:46 UTC although it was not in the catalog.
So every anchor row must be filtered by the catalog.

### What a catalog loader has to build

The engine's catalog is CCXT `loadMarkets`, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, filtered to active swaps at lines 199 to 201.
OrangeX needs a loader of its own, which is the named change on the REST side.

| market field | from | note |
|---|---|---|
| `id`, the `rawMarketId` | `instrument_name` | matches the socket and every anchor call exactly |
| `base` | `quote_currency` | the swap above |
| `quote`, settle | `USDT` | the only family |
| `linear` | true | USDT-margined, S3 |
| `contractSize` | 1 | sizes are in the coin on both the socket and REST, see [`websocket.md`](./websocket.md) section 4 |
| `active` | `is_active` and `creation_timestamp` in the past | `OURA` above |
| taker | `taker_commission` | 0.0006 on all |

Six contracts trade a multiple of the coin: `1000LUNC`, `1000SHIB`, `1000XEC`, `1MBABYDOGE`, `1000000MOG` and `1000CHEEMS`.
They need a price scale to match other venues, at [`../../../server/src/engine/cluster/clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).
Four contracts have Chinese character names, such as `币安人生-USDT-PERPETUAL`, and they work on the socket like any other.
No coin is listed twice, so `marketFilter` is not needed.
`BB`, `QNT` and `ON` are listed, and all three are already in `DENIED_PAIRS` at the same file, lines 8 to 10.
At least 41 contracts are equities, ETFs, commodities or pre-IPO names with no flag, found by a name list in the probe, see [`fees.md`](./fees.md) section 3.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time over 60 polls, three runs |
|---|---|---|---|---|---|---|---|
| `GET /public/tickers?currency=PERPETUAL`, a bulk form S1 does not document | `underlying_price` | `mark_price` | absent | absent | absent | 278 KB, one row per live perpetual | median 203, 206 and 207 ms, p90 216, 223 and 221, max 304, 291 and 295 |
| `GET /public/cmc_contracts`, documented for aggregators | `index_price` | absent, `contract_price` is the last trade | `funding_rate` | absent | `next_funding_rate_timestamp`, ms | 341 KB | median 226 ms in all three, p90 245, 256 and 253, max 336, 608 and 385 |
| `GET /public/get_all_capital_rate`, undocumented, used by the website | absent | absent | `capitalRate` | `endTime` minus `startTime`, ms | `endTime`, ms | 143 KB, 769 rows | median 160, 160 and 161 ms, p90 177, 169 and 168, max 232, 194 and 178 |
| `GET /public/coin_gecko_contracts`, documented for aggregators | `index_price` | absent | `funding_rate` | absent | `next_funding_rate_timestamp` | 309 KB, 578 rows | one read in each of two runs, 228 and 218 ms |
| `GET /public/get_funding_rate?instrument_name=…`, undocumented, one contract | | | `rate` | `capitalRateInterval`, hours | `expire_time`, ms | 152 bytes | 143, 146 and 145 ms |

S1 documents `tickers` with a required `instrument_name`, and with no parameter it returns `"result":[]`.
With `currency=PERPETUAL` it returns every live perpetual.
Two calls cover all five `AnchorRow` fields: `tickers?currency=PERPETUAL` for index and mark, and `get_all_capital_rate` for rate, interval and next settlement.
At the last poll of each run, `cmc_contracts` `funding_rate` equalled `capitalRate` on every live contract, and `next_funding_rate_timestamp` equalled `endTime` on every one.
`underlying_price` equalled `cmc_contracts` `index_price` on 532 of 577, 531 of 578 and 504 of 578 contracts, and the two calls were read about 200 ms apart.
`get_funding_rate` without `instrument_name` answered code 9999 `System error, please try again later`.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument_name` in `tickers`, `instrumentName` in `get_all_capital_rate` | string | none |
| `index` | `tickers` `underlying_price` | decimal string | `Number()` |
| `mark` | `tickers` `mark_price` | decimal string | `Number()` |
| `fundingRate` | `capitalRate` | decimal string, a fraction per interval: `"-0.000025"` is -0.0025 % | `Number()` |
| `fundingIntervalHours` | `endTime` minus `startTime` | ms strings: 1, 4 or 8 h | divide by 3,600,000 |
| `nextFundingAt` | `endTime` | ms string, `"1790150400000"` is 2026-09-23 08:00 UTC | `Number()` |

No live row had a mark, index or `cmc_contracts` index at or below 0 at the last poll of the third run.
The `tickers` rows carry a `timestamp` that was 634 to 3,221 ms old on arrival, with a median of 1,269, 1,253 and 1,240 ms in the three runs.
So the bulk ticker reply is a cache refreshed about once a second, and a reading can be up to 3 s old when the poller stamps it.
`currentTime` in the funding rows is stamped to the minute, for example `2026-09-23T03:36:00.000Z`.

## 4. Anchor semantics

### Index

The mark price page says "an average of the prices on the major markets constitutes the "Price Index" which is the primary component of Mark Price", S2.
The basket and its weights are not published, and no basket call was found.
The website's mark and funding pages call only `get_all_capital_rate`, `get_funding_rate_history`, `get_mp_kline`, `get_open_interest_number`, `get_open_interest_record`, `get_risk_fund_account_asset` and `get_risk_fund_asset_list`, S4.
So whether any index basket contains OrangeX's own perpetual cannot be checked.
The socket's `price_index` channel serves only the documented `btc_usdt` and `eth_usdt`, see [`websocket.md`](./websocket.md) section 2.

### Mark

No mark formula is published.
The page links it to the funding rate and to the index and gives nothing more, S2.
The wire says the mark follows the perpetual's own trades.

| reading | first run, 03:26 UTC | second run, 03:37 UTC | third run, 03:45 UTC |
|---|---|---|---|
| mark equal to the median of best bid, best ask and last, over every ticker row of 60 polls | not measured | 26,718 of 34,680 rows, 77 % | 27,191 of 34,680 rows, 78 % |
| mark equal to the last trade, same rows | not measured | 26,921 of 34,680 rows, 78 % | 27,346 of 34,680 rows, 79 % |
| mark inside the touch, last poll | 558 of 577 | 559 of 578 | 556 of 578 |
| mark over `cmc_contracts` index, absolute, last poll | median 972 ppm, p90 3,597, max 32,258 on `GUN` | median 1,035 ppm, p90 4,219, max 26,880 on `ANTHROPIC` | median 1,123 ppm, p90 4,226, max 26,254 on `ANTHROPIC` |
| contracts more than 10,000 ppm from the index, last poll | 7 | 7 | 5 |
| BTC mark over `underlying_price`, 60 polls | not measured | -552 to -144 ppm, median -360 | -577 to -380 ppm, median -503 |

No clamp on the mark was seen, since it sat as far as 32,258 ppm from the index on one contract.
The large gaps include equity contracts read while US markets were closed, `GS`, `QCOM`, `CSCO` and `JPM`.
For the engine this has two consequences.
The mark over index premium is the perpetual's own basis at its last trade, not a smoothed fair price.
A quiet contract's mark is its last trade, so it can sit still and then jump: `CHR-USDT-PERPETUAL` changed its mark 0, 2 and 2 times in 60 polls, and those jumps put it 4,673 and 4,608 ppm over its index, above the reader's 1,000 ppm per poll limit at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 6.

### Funding

The formula is "Funding Rate = clamp ([premium index + clamp (base rate - premium index, 0.05%, -0.05%)], -0.75%, 0.75%)", S5, and the premium index and base rate are not defined, see [`fees.md`](./fees.md) section 6.
The published `capitalRate` is the rate for the coming settlement, not the last settled one.

| contract | interval | last settled, from the history | `capitalRate` at 03:36 and 03:45 UTC | `startTime` equals the last settlement |
|---|---|---|---|---|
| `BTC-USDT-PERPETUAL` | 8 h | -0.000008 at 00:00 UTC | -0.000025 and -0.000026 | yes, both runs |
| `API3-USDT-PERPETUAL` | 4 h | 0.0001 at 00:00 UTC | -0.000107 and -0.0001 | yes, both runs |
| `IOST-USDT-PERPETUAL` | 1 h | -0.000776 at 03:00 UTC | -0.000885 and -0.000824 | yes, both runs |

The history comes from `POST https://www.orangex.com/api/v2/public/get_funding_rate_history` with the body `{"currentPage":1,"pageSize":12,"params":{"instrId":28}}` for BTC, an undocumented call the website makes, S4.
It returned 272, 543 and 548 settled rows for the three contracts, all on the hour and spaced by the interval.
The v1 path, `GET /api/v1/public/get_funding_rate_history`, which S1 does not document either, answered 8000 `Request params not valid!` to both parameter shapes the probe sends.
The rate is recomputed within the period: BTC's `capitalRate` changed 3, 2 and 3 times in the three 60 s runs, while `currentTime` moved once in each.
The settlement instant was not captured.

### How often each number changed

Changes over 60 one-second polls, per contract, in the three runs.

| number | median contract | p90 | max | BTC |
|---|---|---|---|---|
| `mark_price` | 3, 5 and 4 | 19, 24 and 22 | 58, 57 and 57 | 12, 30 and 23 |
| `underlying_price` | 2, 2 and 2 | 11, 14 and 13 | 43, 47 and 48 | 25, 47 and 34 |
| `cmc_contracts` `index_price` | 2, 2 and 2 | 12, 16 and 18 | 49, 42 and 56 | 22, 37 and 39 |
| `capitalRate` | 0, 0 and 0 | 0, 0 and 0 | 3, 3 and 3 | 3, 2 and 3 |

The socket pushes BTC's index every second, see [`websocket.md`](./websocket.md) section 2.
So BTC's index moving on only 25 to 47 of 60 polls reflects the one second cache of the bulk reply as much as the index itself.

## 5. REST book snapshot

`GET /api/v1/public/get_order_book?instrument_name=BTC-USDT-PERPETUAL&depth=N`, S1.

Two runs, at 03:25 and 03:45 UTC, each reading the depths in this order about 350 ms apart.

| `depth` | levels returned on BTC | bytes | `version`, first run | `version`, second run |
|---|---|---|---|---|
| 20 | 20 and 20 | 975 and 976 | 265433541 | 265439060 |
| 100 | 100 and 100 | 4,122 and 4,132 | 265433542 | 265439059 |
| 500 | the whole book, 432 and 366, then 436 and 359 | 15,729 and 15,673 | 265433538 | 265439051 |
| 0 | the whole book, the same as 500 | 15,729 and 15,673 | 265433538 | 265439051 |
| absent | 50 and 50 | 2,154 and 2,164 | 265433549 | 265439067 |

S1 says "Not defined or 0 = full order book", and the wire returns 50 levels when `depth` is absent.
Bids come descending and asks ascending at every depth.
`CHR-USDT-PERPETUAL` at `depth=100` returned its whole book of 70 and 70 levels.
`version` is the same counter as the socket's `change_id`, see [`websocket.md`](./websocket.md) section 4.
The whole-book replies are older than the limited ones: `depth=500` and `depth=0` returned a `version` 4 and 8 below the `depth=100` read before them.
In the socket runs, `depth=0` read just after `depth=100` came back lower in 10 of 12 reads, by 1 to 22 versions, see [`websocket.md`](./websocket.md) section 4.
The book is not cached: three reads 50 ms apart returned `version` 265433551, 265433553 and 265433553, and 265439074, 265439074 and 265439076 in the rerun, each with a new `timestamp`.
`timestamp` is the reply time, 68 to 74 ms old on arrival, and not the time of the last book change.
The same call also works as a JSON-RPC POST body, `{"jsonrpc":"2.0","id":1,"method":"/public/get_order_book","params":{…}}`.

## 6. Rate limits and errors

| item | value |
|---|---|
| REST limit | Not publicly specified. S1 publishes no request limit for REST |
| socket limit | at most 5 new sockets a minute and fewer than 10 at once, with "IP and account bans" as the stated penalty, S1 |
| limit reached | never, at up to 3 requests a second |
| `Retry-After` | never seen. The headers are `alt-svc`, `content-encoding`, `content-type`, `date`, `transfer-encoding`, `vary` and `via` |
| error transport | HTTP 200 with a JSON-RPC `error` object |

| request | reply |
|---|---|
| unknown instrument on `get_order_book` or `tickers` | `{"error":{"code":5001,"message":"Instrument does not exist.","data":{}}}` |
| the id `BTCUSDT` | 5001 |
| `get_order_book` with no parameter | 8000 `Request params not valid!` |
| unknown method, such as `get_nope`, `get_time` or `get_index_price` | 1000 `No service found` |
| `get_funding_rate` with no instrument | 9999 `System error, please try again later` |
| `get_instruments?currency=NOPE` | `"result":[]` |

A poller cannot rely on the HTTP status, because every refusal seen came as 200.
The engine's poller pauses on 403, 418 and 429, listed at [`../../../server/src/shared/errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1, and on a `RateLimitReplyError` that a venue adapter throws for a limit reported inside a 200 body, at line 17 of the same file and [`../../../server/src/feeds/anchor/AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 192.
OrangeX's limit reply is unknown, since no limit was reached, so an OrangeX poller should treat any body with `error` as a failed round.

## 7. Server time and clock offset

There is no time call, since `get_time` answers 1000 `No service found`.
Every reply carries `usIn` and `usOut`, which S1 calls microseconds and which are milliseconds on the wire, `1790135119408` being 2026-09-23 03:45:19 UTC.
Over five requests, `usIn` minus the local midpoint was -57 to 212 ms with a median of 1 ms, and the outliers were the requests with the slowest round trips of 500 and 597 ms.
In the rerun, with round trips of 142 to 148 ms, it was -2 to 1 ms with a median of -1 ms.
So the clock of this host and the venue agree to within a few ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://api.orangex.com/api/v1/public/tickers?currency=PERPETUAL` and `https://api.orangex.com/api/v1/public/get_all_capital_rate`, both each round, in parallel | the two calls carry all five `AnchorRow` fields for every live perpetual |
| interval | 1,000 ms, the default | medians of 203 to 207 ms and 160 to 161 ms, and the ticker reply refreshes about once a second |
| row mapping | section 3 | |
| skip | funding rows whose `instrumentName` is not a tracked market | 191 dead contracts and `BLAST` are in the funding reply |
| skip | contracts whose `creation_timestamp` is in the future | `OURA` was `is_active` before listing |
| errors | treat a body with an `error` object as a failed round | refusals come as HTTP 200 |
| rate limit pause | the default | no limit, no 429 and no `Retry-After` were seen |
| flag | the mark is the perpetual's last trade on 78 to 79 % of rows, and it moved more than 1,000 ppm in one step on a quiet contract | section 4 |
| flag | the index basket is unpublished, so a self-referential basket cannot be ruled out | section 4 |
| flag | a ticker reading can be 3 s old on arrival | section 3 |
| alternative | the socket's `markprice.perpetual.PERPETUAL` channel carries every mark and index once a second | [`websocket.md`](./websocket.md) section 2 |

The two replies total about 420 KB a second, which is about 36 GB a day at one hertz.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ORANGEX API v1.0.0, sections MarketData, SubscriptionManagement, CMC and CoinGecko | https://openapi-docs.orangex.com | 2026-09-23 UTC | OrangeX.com | paths, parameters, response fields, socket limits, sections 2 to 7 |
| S2 | Mark price | https://www.orangex.com/agreement/mark-pricing | 2026-09-23 UTC | OrangeX.com | index and mark description, section 4 |
| S3 | USDT-Margined perpetual contracts introduction | https://www.orangex.com/agreement | 2026-09-23 UTC | OrangeX.com | linear USDT contracts of one base unit, section 2 |
| S4 | Website bundle, `_app` chunk and the `agreement/funding-rates` and `agreement/mark-pricing` page chunks | https://www.orangex.com/agreement/funding-rates | 2026-09-23 UTC | OrangeX.com | `get_all_capital_rate`, `get_funding_rate_history` on `/api/v2`, the list of calls on the mark and funding pages, sections 3 and 4 |
| S5 | Funding rate | https://www.orangex.com/agreement/funding-rates | 2026-09-23 UTC | OrangeX.com | funding formula, section 4 |
| P1 | `rest-probe.mjs catalog`, `book`, `errors` and `time`, runs at 03:25 to 03:26 UTC and at 03:45 UTC in `all`, and `catalog` again at 03:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.mjs anchor`, runs at 03:26, 03:37 and 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs history`, runs at 03:36 and 03:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/orangex/rest-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P4 | `ws-probe.mjs book`, runs at 03:30, 03:35 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orangex/ws-probe.mjs) | 2026-09-23 UTC | this host | the `depth=0` lag, section 5 |
