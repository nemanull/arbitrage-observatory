# BitMart REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:19 and 03:41 UTC on 2026-09-23, and again between 03:48 and 03:50 UTC in the second pass.

This profile covers the public futures REST API v2 of BitMart (CCXT id `bitmart`) for every perpetual family: the catalog, the anchor, the book, limits and the clock.
Every number was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitmart/rest-probe.mjs) unless a source is named.
The mark price is the gap this profile keeps returning to.
No public REST call returns it for more than one contract, so the anchor needs the WebSocket ticker, see section 3.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api-cloud-v2.bitmart.com`, S1 and CCXT `server/node_modules/ccxt/js/src/bitmart.js` line 122 |
| resolved address | a CNAME to `api-cloud-v2.bitmart.com.cdn.cloudflare.net`, then `104.18.16.176` and `104.18.17.176`, and `2606:4700::6812:10b0` and `2606:4700::6812:11b0` |
| edge | Cloudflare, `cf-ray` suffix `YVR`, `cf-cache-status: DYNAMIC` |
| origin | "We are using Google Cloud Services and deployed in Taiwan.", S1 FAQ Q6 |
| cold request | 252 ms and 211 ms for `GET /contract/public/funding-rate?symbol=BTCUSDT`, in two runs |
| warm request | 121 to 162 ms, p50 140 ms and 128 ms, over 8 requests of the same call in each run |
| bulk catalog | `GET /contract/public/details`, 1,047,653 to 1,047,690 bytes, 327 and 344 ms on the first read |

`openapi-ws-v2.bitmart.com` and `api-cloud.bitmart.com` resolved to the same two Cloudflare addresses.

## 2. Catalog

### The instruments call

`GET https://api-cloud-v2.bitmart.com/contract/public/details` without `symbol` returns every contract, delisted ones included, S1.
Its `status` values are `Trading` and `Delisted`, S1.

| family | `Trading` | traded in the last 24 h | `Delisted` |
|---|---:|---:|---:|
| USDT-M crypto | 196 | 92 | 833 USDT-M rows in all |
| USDT-M TradFi, with `tradfi_info` | 158 | 3 | |
| USDC-M, `BTCUSDC` | 1 | 1 | 6 |
| coin-M, quoted in USD | 4 | 4 | 17 |
| all | 359 | 100 | 856 |

Counts are from `rest-probe.mjs catalog` on 2026-09-23 and the second pass, and `product_type` was 1, perpetual, on all 1,215 rows.

The catalog calls 259 contracts `Trading` that had zero 24 h volume.
127 of them carry `delist_time` 1784973600, which is 2026-07-25 10:00 UTC, two months in the past.
REST books of nine sampled zero volume contracts came back as `null` on both sides for six, bids only for `KSMUSDT` and `CHZUSDT`, and a single ask for `SPYXUSDT`.
So `Trading` does not mean tradable, and the live set is the 100 contracts with volume.

`funding_interval_hours` read 8 on 216 `Trading` contracts, 4 on 141 and 1 on 2, and every 1 h contract had zero volume.
Of the 100 live contracts, 52 were on 8 h and 48 on 4 h.

### How CCXT 4.5.68 maps it

| field | CCXT | wire | verdict |
|---|---|---|---|
| `market.id` | `symbol` | `BTCUSDT`, the same spelling as the socket `data.symbol` and the anchor rows | equal on 1,215 of 1,215 |
| `contractSize` | `contract_size`, `bitmart.js` line 1147 | contracts of `contract_size` coins for linear contracts | equal on 1,215 of 1,215, correct for linear |
| `linear` | hardcoded `true`, line 1145 | coin-M `BTCUSD`, `ETHUSD`, `XRPUSD`, `SOLUSD` are inverse | wrong on 4 contracts |
| `settle` | hardcoded `'USDT'`, line 1117 | `BTCUSDC` and the coin-M contracts do not settle in USDT | wrong on 5 contracts, so CCXT spells them `BTC/USDC:USDT` and `BTC/USD:USDT` |
| `active` | `status` lowercased equals `trading`, line 1143 | 359 active | 259 of the 359 have no volume and often no book |
| `taker`, `maker` | constants `0.004` and `0.0035`, lines 303, 304, 1152, 1153 | | see [`fees.md`](./fees.md) section 8 |

Loading took 1,944 to 1,950 ms, because CCXT also loads the spot catalog.

### Size unit, pairs listed twice, and price scale

Linear sizes are contracts of `contract_size` coins, which CCXT reports, so the engine's `sizeMul` is right for them, see [`websocket.md`](./websocket.md) section 4.
A coin-M contract is a fixed number of US dollars, 100 for `BTCUSD` and 10 for the other three, and CCXT's `contractSize` of 100 or 10 read as coins would inflate its size by the price.

Four bases are listed twice or three times among active markets: `BTC` as `BTCUSDT`, `BTCUSD` and `BTCUSDC`, and `ETH`, `XRP` and `SOL` as USDT-M and coin-M.
The engine takes one market per pair, so a `marketFilter` has to choose, see section 8.

Four contracts carry a 1000 multiplier in the base itself: `1000SHIBUSDT`, `1000PEPEUSDT`, `1000LUNCUSDT` and `1000CHEEMSUSDT`, whose `base_currency` is `1000SHIB` and so on with `contract_size` 1.
They cluster only with venues that name the base the same way, so no price scale is needed.

`ANTHROPICUSDT` is a live TradFi contract at 2,118.76 USDT, while OKX's `ANTHROPIC-USDT-SWAP` read a mark of 218.36 from `GET https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=ANTHROPIC-USDT-SWAP` at 03:42 UTC, which the engine scales by 10 at [`../../../server/src/engine/cluster/clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) line 21.
The two sit about 3 % apart on a synthetic pre-listing price, a standing basis rather than a cross.
Of the four tickers in `DENIED_PAIRS`, `BBUSDT`, `ONUSDT` and `ONEUSDT` are `Delisted` here and `QNTUSDT` is `Trading` with zero volume.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /contract/public/details` | `index_price` | absent | `expected_funding_rate`, and `funding_rate` is the last settled | `funding_interval_hours` | `funding_time`, Unix ms | about 1.05 MB, 1,215 rows | 60 polls in each of two runs: min 176 and 179, p50 184 and 209, p90 254, max 617 and 600 ms |
| `GET /contract/public/funding-rate-v2` | absent | absent | `expected_rate`, and `rate_value` is the last settled | absent | `funding_time`, Unix ms | 18,375 to 18,382 bytes, 96 rows | 60 polls in each of two runs: min 115 and 126, p50 120 and 144, p90 128 and 177, max 160 and 214 ms |
| WebSocket `futures/ticker` without a symbol | `index_price` | `mark_price` | absent | absent | absent | about 107 frames a second, 321 to 327 contracts | each live contract every 1,887 to 6,020 ms, see [`websocket.md`](./websocket.md) section 5 |
| `GET /contract/public/markprice-kline?symbol=` | | `close_price` of the current bar, one contract per call | | | | | 115 to 216 ms over 30 reads in each of two runs |

No REST call carries the mark for more than one contract.
`markprice-kline` is limited to 12 requests per 2 s per IP, S1, so it can serve 6 contracts a second and not the 100 live ones at one poll a second.
`funding-rate-v2` returned exactly the 96 USDT-M and USDC-M contracts that traded in 24 h, and none of the 4 coin-M contracts.
The ticker without a symbol pushed all 100 live contracts and 224 to 227 silent ones, and never pushed 32 to 35 `Trading` contracts in 40 s.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` in both REST calls, `data.symbol` on the ticker | string, `BTCUSDT` | none |
| `index` | ticker `index_price`, or `details` `index_price` | decimal string | `Number()` |
| `mark` | ticker `mark_price` | decimal string, never 0 on 324 and 327 contracts in 40 s | `Number()` |
| `fundingRate` | `details` `expected_funding_rate`, or `funding-rate-v2` `expected_rate` | decimal string, a fraction per interval: `"0.0000382"` is 0.00382 % | `Number()` |
| `fundingIntervalHours` | `details` `funding_interval_hours` | integer hours: 8, 4, 1 | none |
| `nextFundingAt` | `funding_time` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:28 UTC the 8 h contracts read `1790150400000`, 08:00 UTC, and the 4 h contracts read `1790136000000`, 04:00 UTC.
`details` rounds the rates to seven decimals, so `funding_rate` `"0.0000119"` is `rate_value` `"0.000011900082"`.

## 4. Anchor semantics

### Index

The index is "Last traded prices of three of more major exchange as the weighted index constituents for each cryptocurrency", S3.
The futures tutorial names Huobi, Okex, Bittrex, HitBTC, Gate.io, Bitmax, Poloniex and MXC as sources, S4, a list that includes Bittrex, which no longer trades, so it is out of date.
No basket or weight call is documented, S1, and `index_name` equalled `symbol` on 1,215 of 1,215 rows.
So whether any basket includes BitMart's own perpetual is Not publicly specified.
`ASTEROIDETHUSDT` read `index_price` and `mark_price` both `0.0000216`, unchanged for 40 s on the ticker and 60 s on `details` in both runs, while its last price was `0.0000224` and `0.0000223`, which a feed cannot tell apart from a stale index.

### Mark

The mark is "index-based price * (1 + basis rate of funding cost)", "the index-based price with reference to the price of the global spot market plus the funding cost basis that decreases over time", S3.
No clamp is published for crypto contracts.
TradFi contracts carry `tradfi_info.low_liquidity_config.mark_price_bound_ratio` `"0.05"`, a 5 % bound that applies in low liquidity sessions.
Over the 100 live contracts the mark sat a median 437 ppm and 413 ppm from the index in two runs of `ws-probe.mjs ticker`.
The largest gaps were `JCTUSDT` at 4,009 and 4,712 ppm, `FOLKSUSDT` at 3,752 and 2,608 ppm, `MOVEUSDT` at 3,093 ppm, and `FLOKIUSDT` at minus 2,622 ppm.
`THETAUSDT`, `Trading` with an empty book and a last price of 0.1347, still carried a mark of 0.23505625 and an index of 0.23531875, and both kept moving in the second run.

### Funding

The rate is capped at plus or minus 3.75 % per interval, `funding_upper_limit` `"0.0375"` and `funding_lower_limit` `"-0.0375"` on all 96 `funding-rate-v2` rows.
The formula is not published, see [`fees.md`](./fees.md) section 6.

### Which rate is published

| field | documented | wire |
|---|---|---|
| `rate_value` | "Funding rate of the previous period", S1 | equal to the newest `funding-rate-history` row on 5 of 5 contracts, the rate settled at 00:00 UTC |
| `expected_rate` | "Funding rate for the next period", S1 | differs from `rate_value` and moves, so it is the estimate for the settlement at `funding_time` |
| WebSocket `fundingRate` | "Current funding rate", S2 | equal to `rate_value` |
| WebSocket `fundingTime` | "Funding time of the upcoming settlement", S2 | a whole second at or just before the reply: `1790134290000` against `ts` `1790134290542`, and `1790134313000` against `1790134314142` |
| WebSocket `nextFundingRate`, `nextFundingTime` | "Forecasted funding rate for the next period", S2 | the estimate and the settlement time: `ETHUSDT` read `nextFundingRate` `"0.0000997"`, the `expected_rate` REST returned two minutes earlier, and `nextFundingTime` equalled `funding_time` on both contracts read |

CCXT agrees, reading `expected_rate` as `fundingRate` and `rate_value` as `previousFundingRate`, at `bitmart.js` line 5076 and the lines after it.
The engine wants the rate of the upcoming settlement, so `fundingRate` is `expected_rate`.
Whether the final `expected_rate` before a settlement equals the rate then written to history was not captured, since no settlement instant was waited for.

### Settlement history

`GET /contract/public/funding-rate-history?symbol=BTCUSDT&limit=6` listed settlements at 00:00, 16:00 and 08:00 UTC going back, and `ASTEROIDETHUSDT` listed them every 4 h.
The settlement instant itself was not captured.

### How often each number changed

60 polls of `details` and `funding-rate-v2`, one second apart, at 03:28 UTC and again at 03:48 UTC, first run and second run.

| contract | `index_price` changes | `expected_funding_rate` changes | `funding-rate-v2` `expected_rate` changes |
|---|---:|---:|---:|
| `BTCUSDT` | 30 and 25 of 59 | 0 and 11 | 1 and 1 |
| `ETHUSDT` | 30 and 25 | 2 and 9 | 1 and 1 |
| `FOLKSUSDT` | 30 and 25 | 11 and 16 | 1 and 1 |
| `ASTEROIDETHUSDT` | 0 and 0 | 0 and 0 | 0 and 0 |
| `BTCUSD` | 30 and 25 | 11 and 0 | not listed |
| `BTCUSDC` | 30 and 25 | 11 and 16 | 1 and 1 |

`details` refreshes about every 2 s, since its index and last price changed together on 30 of 59 one second intervals in the first run and 25 in the second, on every liquid contract.
`funding-rate-v2` refreshes its estimate once a minute, and its `timestamp` is the reply time, 54 to 100 ms before arrival.
On the ticker, a live contract's mark changed a median 11 times and its index 11 to 12 times in 40 s, over a median 16 frames.
The mark kline close for `BTCUSDT` changed on 16 and 22 of 29 reads taken 2 s apart.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /contract/public/depth?symbol=BTCUSDT`, S1 |
| depth | "Return a maximum of 50 pieces of data", S1. `limit=5` is ignored and 50 came back |
| level | `[price, size, cumulative size]` strings. The third column equalled the running sum on every level of 5 contracts |
| order | bids descending and asks ascending on every contract read |
| empty contract | `"asks":null,"bids":null` with code 1000, for example `THETAUSDT` |
| thin contract | `ASTEROIDETHUSDT` returned 12 and 11 bids and 12 asks |
| caching | six reads 500 ms apart each carried a new `timestamp`, 616 to 633 ms apart over two runs, and `timestamp` was 53 to 72 ms before arrival |
| size unit | contracts, equal to the socket size at the same price, see [`websocket.md`](./websocket.md) section 4 |

## 6. Rate limits and errors

| item | value |
|---|---|
| public limit | per IP, 12 requests per 2 s for `details`, `depth`, `funding-rate`, `funding-rate-v2`, `funding-rate-history`, `kline`, `markprice-kline`, `market-trade` and `leverage-bracket`, and 2 per 2 s for `open-interest`, S1 |
| headers | `x-bm-ratelimit-limit: 12`, `x-bm-ratelimit-reset: 2`, `x-bm-ratelimit-mode: IP`, and `x-bm-ratelimit-remaining`, which counted up 1, 2, 3 on consecutive calls. S1 defines it as "The number of requests that have been used in the current time window" |
| status on a limit | 429, "the IP will be blocked", then 418 "the IP has been blocked after error code 429", S1. Not triggered, since every probe stayed at one request per second per endpoint |
| `Retry-After` | not seen, since no limit was hit |

| request | status | body |
|---|---|---|
| `depth?symbol=NOPEUSDT` | 400 | `{"code":40034,"message":"Symbol Not Exist","trace":"..."}` |
| `depth` without `symbol` | 400 | the same, code 40034 |
| `depth?symbol=LUNAUSDT`, a `Delisted` contract | 400 | the same, code 40034 |
| `funding-rate` without `symbol`, or unknown | 400 | the same, code 40034 |
| `funding-rate?symbol=THETAUSDT`, `Trading` with no volume | 200 | a normal row with `expected_rate` `"0.0001"` |
| `details?symbol=NOPEUSDT` | 400 | `{"code":40012,"message":"SYMBOL_NOT_EXIST","trace":"..."}` |
| `markprice-kline` with `step=2` | 400 | `{"code":40038,"message":"Invalid K-Line Step","trace":"..."}` |
| `GET /contract/v1/tickers` | 200 | `{"trace":"...","msg":"Futures V1 API has been deprecated. Please use the V2 API","code":30030}`, and CCXT still lists this path at `bitmart.js` line 160 |
| an unknown path | 404 | `{"trace":"...","msg":"Not found","code":30000}` |

Success is HTTP 200 with `code` 1000, and a failure keeps its code in the body, so a poller checks `code` as well as the status.

## 7. Server time and clock offset

The futures API documents no time call.
The spot host's `GET https://api-cloud.bitmart.com/system/time`, limited to 10 per second per IP, S5, answered with `server_time` in ms.
Ten reads over two runs gave offsets of 4 to 11 ms against the local midpoint on the seven reads with round trips under 140 ms, and 23 to 145 ms on reads with round trips of 152 to 391 ms.
The futures `funding-rate` reply's `timestamp` was 55 and 54 ms before arrival on 132 and 123 ms requests.
The local clock is within about 10 ms of the venue's.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The engine's `AnchorPoller` is REST only, and BitMart publishes no bulk REST mark, so the anchor cannot be built from REST alone.

| item | recommendation | reason |
|---|---|---|
| named change | a mark source fed by the WebSocket `futures/ticker` without a symbol, stamped on arrival | the only bulk source of `mark_price`, section 3. Without it every BitMart row has mark 0 and every route is refused at open |
| index and mark | both from the same ticker frame | one frame, one instant, so the fresh gate compares an index and a mark read together |
| funding rate and next settlement | `GET /contract/public/funding-rate-v2` every 5 s, `expected_rate` and `funding_time` | 18 KB, 120 ms, and the estimate refreshes once a minute, so 5 s bounds `nextFundingAt` lag after a settlement |
| interval | `GET /contract/public/details` every 60 s, `funding_interval_hours` | 1 MB, and the interval changes only by announcement |
| alternative | `details` every 2 s for index, estimate, interval and next settlement, with only the mark from the ticker | the reply refreshes about every 2 s, at 1 MB a read |
| staleness | flag a contract whose ticker frame is older than 5 s | each live contract arrived every 1.9 to 6.0 s, and the reader refuses legs read more than 5 s apart and readings older than 10 s |
| row mapping | section 3, key `symbol` | |
| market filter | `m.quote === 'USDT'` and `Number(m.info.volume_24h) > 0` | drops the 4 coin-M contracts CCXT mislabels as linear, the `BTCUSDC` duplicate, and the 259 `Trading` contracts with no volume |
| skip | contracts with `delist_time` in the past, and TradFi contracts outside their session | the 127 stale delist markers, and `tradfi_info.market_session_status` 2 on 117 US contracts at 03:20 UTC, with `next_session_switch_ts` at 13:30 UTC, the US open, and `next_session_switch_status` 1 |
| rate limit pause | `rateLimitPauseMs` 2,000 | the window is 2 s, and no `Retry-After` was seen |
| deny list input | `ANTHROPICUSDT`, a synthetic pre-listing price 3 % from OKX's scaled one | section 2 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitMart Futures API v2 documentation, REST sections, rate limits, FAQ and error codes | https://developer-pro.bitmart.com/en/futuresv2/ | 2026-09-22 | BitMart, global | base URL, calls and fields, limits, status codes, sections 1 to 6 |
| S2 | BitMart Futures API v2, Funding Rate Channel | https://developer-pro.bitmart.com/en/futuresv2/ | 2026-09-22 | BitMart, global | WebSocket funding fields, section 4 |
| S3 | Definitions and Calculation of Last Trade Price, Index Price and Marking Price, updated 2022-09-15 | https://bitmart.zendesk.com/hc/en-us/articles/360045289773-Definitions-and-Calculation-of-Last-Trade-Price-Index-Price-and-Marking-Price | 2026-09-22 | BitMart, global | index and mark formula, section 4 |
| S4 | BitMart Futures Tutorial 04: Futures Knowledge and Function Introduction, updated 2025-12-03 | https://bitmart.zendesk.com/hc/en-us/articles/11101353769243-BitMart-Futures-Tutorial-04-Futures-Knowledge-and-Function-Introduction | 2026-09-22 | BitMart, global | index sources, section 4 |
| S5 | BitMart Spot API documentation, system time and service status | https://developer-pro.bitmart.com/en/spot/ | 2026-09-22 | BitMart, global | time call and its limit, section 7 |
| S6 | CCXT 4.5.68 `bitmart.js` | `server/node_modules/ccxt/js/src/bitmart.js` | 2026-09-22 | CCXT | market mapping at lines 1117 to 1153, fee constants at 303 and 304, funding parse at 5076, v1 path at 160, sections 2 to 6 |
| P1 | `rest-probe.mjs catalog` at 03:26 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitmart/rest-probe.mjs) | 2026-09-22 | this host | section 2 |
| P2 | `rest-probe.mjs anchor` at 03:28 and 03:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitmart/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs book` and `limits` at 03:29 and 03:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitmart/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 5, 6 and 7 |
| P4 | `ws-probe.mjs ticker` at 03:35 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | the ticker as the mark source, sections 3 and 4 |
