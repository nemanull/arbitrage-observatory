# One Trading REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:15 and 20:50 local time, which is 2026-09-23 03:15 to 03:50 UTC.

This profile covers the public REST API of One Trading (CCXT id `onetrading`) that a catalog, an anchor poller and a book resync would use, for its USD 5-Year Crypto Dated Futures, see [`fees.md`](./fees.md) section 3.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

`api.onetrading.com` resolved to `104.18.19.115`, `104.18.18.115`, `2606:4700::6812:1273` and `2606:4700::6812:1373`, which are Cloudflare, P1.
Replies came through Cloudflare points of presence ending `-SEA` and `-YVR`, and each carried two `apigw-requestid` headers, which is the AWS API Gateway behind it, P1 and P5.
Every valid public request answered HTTP 200, with no geoblock.

| call | reply | cold | warm, 5 reads 300 ms apart |
|---|---|---|---|
| `GET /fast/v1/time` | 63 B | 799 ms | min 377, median 389, max 790 ms |
| `GET /fast/v1/instruments` | 10,486 B | 388 ms | min 384, median 391, max 783 ms |
| `GET /fast/v1/market-ticker` | 7,441 B | 387 ms | min 381, median 774, max 794 ms |
| `GET /fast/v1/funding-rate` | 1,935 B | 398 ms | min 390, median 396, max 818 ms |
| `GET /fast/v1/funding-rate/settings` | 1,752 B | 431 ms | min 389, median 400, max 803 ms |
| `GET /fast/v1/fees` | 1,923 B | 1,041 ms | min 379, median 382, max 788 ms |
| `GET /fast/v1/currencies` | 14,173 B | 1,009 ms | min 989, median 997, max 1,005 ms |
| `GET /fast/v1/order-book/BTC_USD_P?level=2` | 1,281 B | 385 ms | min 379, median 384, max 395 ms |

The reruns at 03:45 UTC through `-YVR` and at 03:55 UTC through `-SEA` gave warm minimums of 370 to 463 ms and medians of 376 to 1,028 ms.
Read times fall in two groups, about 380 ms and about 780 ms, with little between them.
The clock probe shows why: the slow reads reached the server clock about 200 ms later than the fast ones, so the extra time is spent before the request reaches the origin, see section 7.

## 2. Catalog

### The instruments call

`GET /fast/v1/instruments` returns every instrument in one array, 32 rows on 2026-09-23 03:30 UTC, P1.
The documented `type` filter takes `SPOT` or `DATED_FUTURE`, S1, and `type=PERP` also works and returned the 4 closed perpetuals, P5.
The documented states are `ACTIVE`, `SUSPENDED`, `POST_ONLY` and `CLOSED`, S1.

| type | quote | state | rows |
|---|---|---|---:|
| `DATED_FUTURE` | USD | `ACTIVE` | 10 |
| `EQUITY_FUTURE` | USD | `ACTIVE` | 2 |
| `EQUITY_FUTURE` | USD | `POST_ONLY` | 1 |
| `PERP` | EUR | `CLOSED` | 4 |
| `SPOT` | USDC | `ACTIVE` | 2 |
| `SPOT` | EUR | `ACTIVE` | 1 |
| `SPOT` | USDC, EUR or BTC | `CLOSED` | 12 |

A dated future row carries `contract_expiry_date` `"2031-04-20"`, `contract_duration` `"5Y"`, `funding_schedule` `{"type":"FIXED_INTERVAL","period_minutes":240}`, a deprecated `funding_period` of 240, `market_offset` from 0 to 9, `price_collar_percentage` `"10"`, and `min_size`, a minimum order in USD, 10 on eight contracts and 1 on `DOGE_USD_P` and `ADA_USD_P`, P1 and S1.

### How CCXT 4.5.68 maps it

| item | value | source |
|---|---|---|
| markets | 32: 15 spot active, 13 spot inactive, 4 swap inactive | P1 |
| active swaps | 0 | P1 |
| `BTC_USD_P` | symbol `BTC/USD`, `type` `spot`, `swap` false, `linear` undefined, `contractSize` undefined, `settle` undefined, `active` true, `taker` 0.0015 | P1 |
| `BTC_EUR_P` | symbol `BTC/EUR:EUR`, `type` `swap`, `linear` true, `contractSize` 1, `settle` EUR, `active` false | P1 |
| mapping rule | only `type === 'PERP'` becomes a swap, everything else is spot | `server/node_modules/ccxt/js/src/onetrading.js` lines 537 and 551 |
| `active` | `state === 'ACTIVE'`, so `POST_ONLY` reads inactive | same file, line 557 |
| `market.id` | the `id` field, `BTC_USD_P` | same file, line 532 |

The connector keeps markets whose `type` is `swap`, `swap` is true and `active` is not false, at `server/src/ccxt/connector.ts` lines 79 and 196 to 203.
That leaves no market, and the connector logs `no usable swap markets; skipping the venue` and skips the venue, at lines 50 to 52.
A `marketFilter` cannot help, since it runs only on the markets that filter kept, at lines 80 to 82.
CCXT master, version 4.5.82 on 2026-09-22, maps the same way, S6.
So loading this venue needs a named change: an override of CCXT's `parseMarket` for `onetrading` that types a `DATED_FUTURE` whose `funding_schedule.type` is `FIXED_INTERVAL` as a linear swap with `contractSize` 1 and settle USD.

`market.id` is the identifier every other call uses.
On 10 of 10 active dated futures it equalled the `instrument_code` of `market-ticker`, of `funding-rate` and of the WebSocket book, P1 and [`websocket.md`](./websocket.md) section 3.

### Size unit, pairs listed twice, and price scale

Sizes are base asset units with no multiplier, so a `contractSize` of 1 is right, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice among active contracts, since the EUR perpetuals are closed.
If they reopened, `BTC/EUR` would not cluster with a USD pair anyway, because EUR is outside the quote family at `server/src/engine/cluster/quoteFamily.ts` lines 3 to 6.
No contract is quoted per 10 or per 1000 units, and the underlyings are ordinary coins, so no price scale or `DENIED_PAIRS` line is needed, P1.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time over 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /fast/v1/market-ticker` | absent | `mark_price` | `funding_rate` | absent | `next_funding_payment`, ISO 8601 | 7,441 B, 16 rows of every type | min 372 to 385, median 390 to 401, p90 793 to 812, max 819 to 3,235 ms over three runs |
| `GET /fast/v1/funding-rate` | absent | `mark_price` | `funding_rate` | absent | absent | 1,935 B, 12 rows, dated and equity futures | min 379 to 395, median 397 to 421, p90 793 to 834, max 870 to 1,027 ms over three runs |
| `GET /fast/v1/funding-rate/settings` | absent | absent | absent | `period`, minutes | absent | 1,752 B, 12 rows | one read |
| `GET /fast/v1/instruments` | absent | absent | absent | `funding_schedule.period_minutes` | absent | 10,486 B | one read |

No public call and no WebSocket channel carries an index price.
The documentation of `market-ticker` does not list `mark_price`, `funding_rate` or `next_funding_payment`, S2, and the wire carries all three.
One call, `market-ticker`, carries mark, rate and next settlement for every dated future, P2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument_code` | string, `BTC_USD_P` | none |
| `index` | none | | none exists, see below |
| `mark` | `mark_price` of `market-ticker` | decimal string | `Number()` |
| `fundingRate` | `funding_rate` of `market-ticker` | decimal string, a fraction per 4 h: `"0.000017903317919671466"` is 0.00179 % | `Number()` |
| `fundingIntervalHours` | `funding_schedule.period_minutes` of `instruments` | integer minutes, 240 | divide by 60 |
| `nextFundingAt` | `next_funding_payment` of `market-ticker` | ISO 8601, `"2026-09-23T04:00:00.000Z"` | `Date.parse()` |

The engine rejects a row whose index is not a positive finite number as `index_invalid`, at `server/src/engine/Engine.ts` lines 558 to 561.
The reader also needs the index for the mark and touch premiums, at `server/src/engine/opportunity/anchorReading.ts` lines 58 and 82 to 83.
So a poller for this venue cannot fill a valid row, and every route through it would be refused at open.
That is the blocker of this profile, see section 8.

## 4. Anchor semantics

### Index

The index is a Kaiko benchmark per contract, `KK_BRR_BTCUSD`, `KK_BRR_ETHUSD`, `KK_BRR_XRPUSD`, `KK_BRR_SOLUSD`, `KK_BRR_DOGEUSD`, `KK_BRR_ADAUSD`, `KK_BRR_LINKUSD`, `KK_BRR_SUIUSD` and `KK_RFR_TAOUSD`, S4 section 8.
The LTC line reads `KK_BRR_KTCUSD`, which looks like a typo for `KK_BRR_LTCUSD`, S4.
The Kaiko rates are licensed data, and One Trading publishes neither the index value nor its basket.
When Kaiko is unavailable One Trading uses "the mid-price of the best bid and best ask prices available on" a reputable spot exchange of its choice, S4 section 8 and S3 section 7.6.
The index is external to One Trading, so the self-referential basket of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not apply.

### Mark

The Mark Price is the median of the last traded price, the best bid and the best ask, and One Trading "may calculate the Mark Price based on the Index Price" when the median is not orderly, S3 section 7.4.
It moves only by whole ticks, S3 section 7.4, of 0.01 USD on BTC, ETH, LTC and TAO, 0.001 on SOL and LINK, and 0.0001 on XRP, DOGE, SUI and ADA, S4 section 7.
The Settlement Price, which drives profit and loss, is the same median over the best bid and ask "within the last 5 seconds", calculated once per minute, S3 sections 5.1 and 7.2.
No clamp on the mark is published.

The mark changes once a minute on the wire, in three runs of 60 polls a second apart, P2.

| run | `market-ticker` mark changes per contract | `funding-rate` mark changes per contract | polls on which the two calls agreed |
|---|---|---|---|
| 03:34 UTC | 1 on seven contracts, 0 on `BTC_USD_P`, `ADA_USD_P` and `DOGE_USD_P` | the same | 33 to 60 per contract, 0 on `BTC_USD_P` |
| 03:46 UTC | 1 on all ten | 1 on all ten | 39 per contract, 1 on `BTC_USD_P` |
| 03:47 UTC | 1 on all ten, at poll 10 on six contracts and poll 23 on four | 1 on all ten, all at poll 37 | 33 or 46 per contract |

The two calls do not publish together.
In the run that logged the poll, `market-ticker` moved at poll 10 or 23 and `funding-rate` at poll 37 on every contract, 14 to 27 s later.
One run is not enough to say that the ticker always leads.
The `funding-rate` row was 27 to 95 s past its own stamp when read, in all three runs.
The funding rate changed on the same poll as the mark in every run.
The ticker mark equalled the ticker's last trade price on 0 to 60 of 60 polls, depending on the contract, which fits a median of last, bid and ask.

A mark that steps once a minute and is the median of the venue's own book has two effects on the engine.
The move guard sees 59 polls with no move and then the whole minute in one poll, which can exceed the 1,000 ppm limit at `server/src/engine/opportunity/anchorReading.ts` line 6.
The fresh premium compares a live touch with a mark up to a minute old that was computed from the same book.

### Funding

The rate is an interest term of 4% a year, 0.0000179092 per 4 h, plus a clamped time-weighted premium of mark over index, then capped at 0.001, see [`fees.md`](./fees.md) section 6.
`clamp_threshold` is 0.0005 and `cap` is 0.001 on every contract, P3.
The published `funding_rate` is the preliminary rate for the upcoming settlement, "recalculated every minute and settled every 4 hours at fixed intervals (00:00 UTC, 04:00 UTC, 08:00 UTC, 12:00 UTC, 16:00 UTC, and 20:00 UTC)", S5.
The `funding-rate` call stamps each row at a whole minute plus `market_offset` seconds: `BTC_USD_P` at :00, `ETH_USD_P` :01, `XRP_USD_P` :02, `SOL_USD_P` :03, `LINK_USD_P` :04, `SUI_USD_P` :05, `LTC_USD_P` :06, `TAO_USD_P` :07, `DOGE_USD_P` :08 and `ADA_USD_P` :09, which equals each contract's `market_offset`, P3.
`GET /fast/v1/funding-rate/history` returns the settled rate and the mark at each settlement, 18 rows per contract over three days at the six hours above, P3.
The instant of a settlement was not captured, and whether the ticker's rate resets right after the hour is Not verified.

### How often each number changed

Over 60 polls a second apart, in each of three runs at 03:34, 03:46 and 03:47 UTC, P2.

| field | changes per run |
|---|---|
| `mark_price`, both calls | 0 or 1 per contract |
| `funding_rate`, both calls | 0 or 1 per contract, on the same poll as the mark |
| `funding-rate` `time` | 1 per contract, once a minute |
| `next_funding_payment` | 0, `2026-09-23T04:00:00.000Z` throughout |

## 5. REST book snapshot

`GET /fast/v1/order-book/{instrument_code}` takes `level` 1, 2 or 3 and `depth` 1, 2, 4, 8 or 16, S7.

| query on `BTC_USD_P` | reply |
|---|---|
| none | 16 bids and 14 asks, the level 2 shape |
| `level=1` | 1 and 1 |
| `level=2` | 16 and 14, each level `{"price", "amount"}` |
| `level=3` | 16 and 14, the same aggregated `{"price", "amount"}` shape, no order ids |
| `level=2&depth=1` | 1 and 1 |
| `level=2&depth=16`, `level=3&depth=16` | 16 and 14 |
| `depth=20`, `depth=32` | 400 `{"error":"INVALID_DEPTH"}` |
| `level=4`, `level=9` | 400 `{"error":"INVALID_LEVEL"}` |

Bids are descending and asks ascending on every read.
The reply carries `time` in ns and `unum_bids` and `unum_asks`, the same counter as the WebSocket updates, so a REST book can be matched to the stream exactly, see [`websocket.md`](./websocket.md) section 4.
The other dated futures held 9 to 16 bids and 6 to 14 asks at level 3 over two runs, and the spot books `BTC_USDC` and `ETH_USDC` held exactly 16 and 16 in both, P4.
The book is not cached: ten reads 100 ms apart on `ETH_USD_P` returned `unum` 27127039 rising to 27127066, and 27133029 rising to 27133063 in the rerun, repeating only when the book had not changed, with `cf-cache-status` `DYNAMIC` and no `cache-control`, P4.

## 6. Rate limits and errors

"Sending too many requests in a short period will result in HTTP status 429 (limit is 240 requests per minute)", S8.
CCXT spaces calls 300 ms apart, 200 a minute, at `server/node_modules/ccxt/js/src/onetrading.js` line 23.
The probe stayed at two calls a second and never met a limit, and no reply carried a rate limit or `Retry-After` header, P5.

| request | status | body |
|---|---|---|
| `order-book/NOPE_USD_P` | 400 | `{"error":"INVALID_INSTRUMENT_CODE"}` |
| `order-book/BTC_EUR_P`, a closed perpetual | 500 | `{"error":"Error fetching order book snapshot for BTC_EUR_P"}` |
| `order-book/BTC_USD_P?depth=32` | 400 | `{"error":"INVALID_DEPTH"}` |
| `order-book/BTC_USD_P?level=9` | 400 | `{"error":"INVALID_LEVEL"}` |
| `market-ticker/NOPE_USD_P` | 400 | `{"error":"The requested market NOPE_USD_P is not available."}` |
| `funding-rate?instrument_code=NOPE_USD_P` | 400 | `{"error":"INVALID_INSTRUMENT_CODE","error_message":"Invalid instrument codes: NOPE_USD_P. Valid codes: ONEX100_USD_P, SPCX_USD_P, BTC_USD_P, …"}` |
| `funding-rate/history?instrument_code=BTC_USD_P&limit=5000` | 400 | `{"error":"INVALID_PAGE_SIZE","error_message":"page_size must be between 1 and 100, got: 5000"}` |
| `nope` | 404 | `{"message":"Not Found"}` |

Errors are JSON with an `error` code string, sometimes with an `error_message`.
The engine's poller pauses on 403, 418 and 429, at `server/src/shared/errors.ts` line 1, and a 429 here would come without a `Retry-After`, so the configured pause applies.

## 7. Server time and clock offset

`GET /fast/v1/time` returns `{"iso": "2026-09-23T03:15:44.464Z", "epoch_millis": 1790133344464}`, P1.
Ten reads 500 ms apart took 381 to 795 ms, and 378 to 786 ms in the rerun, P6.
At the fastest read, 381 ms and then 378 ms, the server clock was 8.5 ms and then 10 ms ahead of this host, with the round trip bounding the error to about 190 ms.
The reads that took about 780 ms put the server about 210 ms ahead, which only means their extra time came before the server read its clock.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| status | do not activate the venue until the index question has an answer | no public index, and the engine rejects a row without one |
| URL | `https://api.onetrading.com/fast/v1/market-ticker` | one call carries mark, rate and next settlement for every contract |
| interval | 1,000 ms, the default | median 390 to 401 ms and p90 793 to 812 ms over three runs of 60 polls, and 60 of the 240 requests a minute |
| interval column | `period_minutes / 60` from `instruments`, read at boot | the ticker has no interval |
| row mapping | section 3, key `instrument_code` | |
| skip | rows whose `type` is not `DATED_FUTURE` or whose `state` is not `ACTIVE` | the ticker mixes spot, equity futures and dated futures |
| rate limit pause | `rateLimitPauseMs` 60,000 | the limit is per minute and no `Retry-After` is sent |
| catalog | the `parseMarket` override of section 2 | CCXT types every dated future as spot |

Three ways to supply the index were considered, and none is recommended here.

- Take the index from the mark, which makes the mark premium zero and turns the fresh gate into a comparison of the touch with a minute-old median of the same book.
- License the Kaiko benchmark rates the contracts settle on, which is outside the public data this survey covers.
- Take the index from another venue's index for the same coin, which changes what the reader means by a leg's own index.

The bulk reply is about 640 MB a day at one hertz, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Instruments | https://docs.onetrading.com/rest/public/instruments | 2026-09-22 | One Trading API | `type` filter, states, dated future fields, section 2 |
| S2 | Market Ticker | https://docs.onetrading.com/rest/public/market-ticker | 2026-09-22 | One Trading API | the documented fields omit mark and funding, section 3 |
| S3 | ONEX Crypto Futures, Product Specifications, April 2026 | https://www.onetrading.com/futures-specifications | 2026-09-22 | ONEX | mark, settlement price, index fallback, section 4 |
| S4 | Supplemental Information to ONEX Rulebook and ONEX Futures, June 2026 | https://www.onetrading.com/supplemental_information_to_onex_rulebook_and_onex_futures | 2026-09-22 | ONEX | Kaiko index tickers, tick sizes, section 4 |
| S5 | Current Funding Rate | https://docs.onetrading.com/futures/current-funding-rate | 2026-09-22 | One Trading API | preliminary rate, settlement hours, section 4 |
| S6 | CCXT master `onetrading.ts`, version 4.5.82 | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/onetrading.ts | 2026-09-22 | CCXT | the mapping is unchanged upstream, lines 552 to 576, section 2 |
| S7 | Order Book | https://docs.onetrading.com/rest/public/orderbook | 2026-09-22 | One Trading API | `level` and `depth` enums, section 5 |
| S8 | What should I know about One Trading API?, updated 2026-07-09 | https://support.onetrading.com/hc/en-gb/articles/16357722538129 | 2026-09-22 | One Trading Exchange B.V. | 240 requests a minute and 429, section 6 |
| S9 | CCXT 4.5.68 `onetrading.js` | `server/node_modules/ccxt/js/src/onetrading.js` | 2026-09-22 | CCXT | market mapping, `rateLimit`, sections 2 and 6 |
| P1 | `rest-probe.mjs catalog` at 03:30, 03:45 and 03:55 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 2 and 7 |
| P2 | `rest-probe.mjs anchor` at 03:34, 03:46 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs funding` at 03:35 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | settings, history, `market_offset` stamps, section 4 |
| P4 | `rest-probe.mjs book` at 03:36 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P5 | `rest-probe.mjs errors` at 03:36 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | headers, error shapes, sections 1, 2 and 6 |
| P6 | `rest-probe.mjs time` at 03:37 and 03:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/onetrading/rest-probe.mjs) | 2026-09-23 UTC | this host | section 7 |
