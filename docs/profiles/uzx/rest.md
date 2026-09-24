# UZX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:37 to 07:07 UTC over two passes), from the development host near Seattle, through its Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of UZX for its two perpetual families, USDT-M (`SWAP`) and coin-M (`BASE`).
UZX has no CCXT class, see [`fees.md`](./fees.md) section 8, so every mapping below is what a catalog loader outside CCXT would have to do.
Every claim is from [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) or from the documentation S1, and every access result is from the Canadian VPN exit, never from a US address.

## 1. Host and latency from this machine

| host | role | resolved to | edge seen |
|---|---|---|---|
| `api-v2.uzx.com` | documented REST host, S1 | 172.67.222.220 and 104.21.70.106, Cloudflare | `cf-ray` suffix SEA or YVR, `/cdn-cgi/trace` gave `loc=CA`, `colo=SEA` |
| `api.uzx.com` | host the web client calls, and the only one carrying the undocumented `/v2/info/...`, `/uc/...` and `/content/...` routes | the same two addresses | SEA |
| `stream.uzx.com` | documented WebSocket host | the same two addresses | `loc=CA`, `colo=SEA`, and `colo=YVR` in the third run |
| `www.uzx.com` | web site and the documentation | 3.165.160.19, .51, .67 and .73, CloudFront | `x-amz-cf-pop` SEA900-P6 |

| call | cold | warm |
|---|---|---|
| `GET /v2/products`, 63,113 bytes | 274, 396 and 307 ms in three runs | 90 to 98, 140 to 152 and 110 to 128 ms |
| `GET /notification/swap/tickers`, about 34.5 KB decoded | | three runs of 60 polls: median 70.0, 80.7 and 95.0 ms, p90 76.6, 85.7 and 98.2 ms, max 237.5, 104.0 and 103.3 ms |

Replies are Brotli encoded on the wire (`content-encoding: br`), and the sizes above are decoded.

Access from this host was open.
Every public call to `api-v2.uzx.com` and `api.uzx.com` returned HTTP 200 or a documented error, and no call was refused, challenged or geoblocked.
The only call that asked for more was `POST https://api.uzx.com/content/limit/region/judgeByIp`, the web client's own region check, which answered HTTP 401 `{"code":401,"msg":"The current login status has expired, please login again!"}`.
The terms exclude the United States, Malaysia and Ontario, see [`fees.md`](./fees.md) section 1, and nothing in the public API enforced that against this Canadian exit.

## 2. Catalog

### The instruments call

`GET https://api-v2.uzx.com/v2/products`, documented as "Get Product List" with a limit of 10 per second, S1.
It takes `ins_type` of `SPOT`, `SWAP` or `BASE` and `product_name`, S1.

| read on 2026-09-23 | value |
|---|---|
| rows | 151: 85 `SPOT`, 60 `SWAP`, 6 `BASE` |
| `?ins_type=SWAP` | 25,641 bytes, the 60 USDT-M rows |
| `?ins_type=BASE` | 2,533 bytes, the 6 coin-M rows |
| `?ins_type=NOPE` | ignored, all 151 rows |
| fields | `ins_type`, `product_name`, `base_coin_name`, `quote_coin_name`, `price_precision`, `num_precision`, `max_once_vol`, `max_once_amount`, `min_once_vol`, `min_once_amount`, `swap_value`, `price_unit`, `max_leverage`, `max_once_limit_num`, `max_once_market_num`, `max_hold_num`, `maintenance_margin_rate`, `market_max_deeps`, `max_book_num` |

The product list has no status field.
The documentation defines a contract status enum of 1 "Active" and 2 "Trading suspended", S1, and only the undocumented web call `GET https://api.uzx.com/v2/info/swap-usdt/symbols` (and `/v2/info/swap-base/symbols`) carries it.
All 66 perpetuals read `status` 1 and `front_hidden` false, and the two web calls list exactly the same 66 names with the same `swap_value` as `/v2/products`, P1.
The web rows add `circuit_rate` (0.002, 0.004, 0.005, 0.01 or 0.012), `price_range` (0.003, 0.03, 0.05, 0.06 or 0.1), a tiered `step_maintenance_margin_rate` and empty `taker_fee` and `maker_fee`, P1.

`market_max_deeps` is 10 on 60 perpetuals, 20 on `XAUUSDT` and 50 on `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `DOGEUSDT` and `KAITOUSDT`, P1.
It is not the book depth, since the socket and the REST book carry hundreds of levels on those contracts, see section 5.

### Mapping a catalog loader would need

There is no CCXT mapping to check, so this is the mapping from the raw rows.

| engine field | USDT-M (`SWAP`) | coin-M (`BASE`) |
|---|---|---|
| `rawMarketId` | `product_name`, `BTCUSDT` | `product_name`, `BTCUSD` |
| base | `base_coin_name`, `BTC` | empty string, and the coin is in `quote_coin_name`, so the base must be taken from `quote_coin_name` |
| quote | `quote_coin_name`, always `USDT` | USD, which appears nowhere in the row |
| settle | USDT | the coin in `quote_coin_name` |
| linear | true | false, inverse |
| `contractSize` | `swap_value` coins per contract: 0.001 on 4, 0.01 on 10, 0.1 on 15, 1 on 29, 10 on `ASTERUSDT`, 100 on `PENGUUSDT` | `swap_value` 100, in USD |
| active | `status` 1 in the web call | same |

`product_name` is the id everywhere.
It is the socket's subscribe `symbol`, its `topic` and its `product_name`, the bulk ticker's `symbol`, and the path segment of every per symbol REST call, P1 and [`websocket.md`](./websocket.md) section 3.
`base_coin_name + quote_coin_name` equals `product_name` on all 60 USDT-M rows.

### Size unit, pairs listed twice, and price scale

Book sizes are integer contract counts, and a contract is `swap_value` coins, see [`websocket.md`](./websocket.md) section 4.
The ticker `vol` is in coins, not contracts: BTCUSDT `turn_over` 2,634,084,527 USDT over `vol` 30,552.579 is 86,215, which is the price, P2.
So a loader must set `contractSize` from `swap_value` and never from the ticker.

Six pairs are listed twice: BTC, ETH, DOGE, XRP, SOL and LTC exist as USDT-M and as coin-M.
The quote family ranks USDT ahead of USD, so the coin-M rows would be ranked out and need no feed, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).

`1000SATSUSDT` has base `1000SATS`, and its index sat within 900 ppm of Binance's `1000SATSUSDT` index in every read, since it was never among the five largest gaps, so it is quoted per 1,000 SATS like Binance's contract, P4.
`PENGUUSDT` (100 PENGU) and `ASTERUSDT` (10 ASTER) have large contract sizes and ordinary per coin prices.
`UZXUSDT` is the venue's own token, and it has no counterpart on Binance, P4.
`XAUUSDT` is gold.

The bulk ticker also returns 8 delisted contracts that are not in the catalog, with zero prices and no `funding_next_time`, see section 3.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /notification/swap/tickers` | `index.close` | `tag.close` | `funding_rate` | absent | `funding_next_time`, Unix seconds | about 34.5 KB, 74 rows | median 70.0, 80.7 and 95.0 ms over three runs of 60 polls, none over 1 s |
| `GET /v2/info/swap/history/funding?symbol=<id>&page=1&size=1` on `api.uzx.com` | | | the last settled rate | `cycle`, hours | | one contract per call | |

The bulk ticker is documented, S1 "Swap Tickers", with a limit of 20 per 2 s per IP.
Its rows carry `market` (24 h open, close, low, high, `turn_over`, `count`, `vol`, `change`, `change_percent`), `index` and `tag` (open, close, low, high), `funding_rate`, `funding_next_time`, `pre_funding_rate`, `symbol` and `risk_fund`.
The REST table calls `tag` "Tag Data", and the socket's overview table calls it "Mark price", S1.
The reply carries every live perpetual of both families and 8 delisted rows (`XPINUSDT`, `LISTAUSDT`, `UMAUSDT`, `COAIUSDT`, `POWRUSDT`, `PEOPLEUSDT`, `SANDUSDT`, `MYXUSDT`) with a zero `market.close` and no `funding_next_time`, and `COAIUSDT` and `XPINUSDT` also read a zero index, P1 and P2.
The reply's top level `ts` was 38, 49 and 63 ms old on arrival at the median, P2.

The interval is the one `AnchorRow` column the bulk call lacks.
The documentation has no funding endpoint at all.
The web client's funding history call, which takes `symbol`, `page`, `size`, `begin` and `end`, returns `{"current", "total", "list": [{"cycle", "rate", "symbol", "time"}]}` with `cycle` in hours and `time` in Unix ms, P3.
It answered all 66 perpetuals, and `funding_next_time` minus the newest settlement `time` equalled `cycle` on 66 of 66, P3.
Without `symbol` it answers HTTP 422 `{"code":100400,"msg":"Invalid parameters","data":null}`.

The socket channel `swap.overview` pushes the same rows as the bulk ticker for the 66 live perpetuals once a second, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none, equals `product_name` |
| `index` | `index.close` | decimal string | `Number()` |
| `mark` | `tag.close` | decimal string, never 0 on the 66 live rows | `Number()` |
| `fundingRate` | `funding_rate` | decimal string, a fraction per interval, `"0.00007001"` | `Number()` |
| `fundingIntervalHours` | `cycle` of the newest settlement, from the funding history call | integer hours, 8 on 58 and 4 on 8 | none |
| `nextFundingAt` | `funding_next_time` | integer Unix seconds, `1790150400` is 2026-09-23 08:00 UTC | multiply by 1,000 |

At 06:39 and 07:01 UTC on 2026-09-23 all 66 live rows read `funding_next_time` 1790150400, which is 08:00 UTC, including the 8 contracts on 4 h, whose previous settlement was 04:00 UTC, P2 and P3.
`pre_funding_rate`, documented as "Predicted Funding Rate", equalled `funding_rate` on every row in all three runs, P2.

## 4. Anchor semantics

### Index

The index formula and basket are Not publicly specified.
No basket call exists in S1, and the web client has no index composition strings, S4.
The UZX index is not Binance's index.
Over 58 contracts both venues list, the median gap to Binance USD-M `indexPrice` was 166, 171 and 154 ppm in three reads, only 2, 1 and 0 were identical, and the largest gaps were `AVNTUSDT` at -12,076 and -11,873 ppm and `BIGTIMEUSDT` at -6,822 ppm, P4.
`UZXUSDT` indexes the venue's own token, which Binance USD-M does not list, and its basket is unpublished.
Whether that basket is mostly UZX's own market is Not verified, and it is the self-referential shape the design warns about, see [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
Its index changed 0 and 16 times in two runs of 60 one second polls, P2.

### Mark

The mark formula is Not publicly specified.
The only published price band is the order limit rule: "Buy Order Max Price = Min [Max (Index, Index × (1 + 0.5%) + Avg Premium in Last 2 Min), Index × (1 + 1%)]" and the mirror for sells, S4.
That bounds orders to 1 % from the index, and it is not stated to bound the mark.
On the last poll of the 06:39 run, `tag.close` sat a median of 387 ppm from `index.close`, p90 1,360 ppm, and at most 6,299 ppm on `1000SATSUSDT`, whose last trade was 10,236 ppm above its index, P2.
At 07:02 the median was 405 ppm, p90 1,021 ppm, and the largest 5,747 ppm on `BIGTIMEUSDT`, whose last trade was 6,897 ppm above its index, P2.
So a premium cap below 0.63 % is ruled out, and the mark sits between the index and the last trade on those rows.
The mark equalled the last trade on 17 and 15 of 66 contracts, and it differed from Binance's mark by a median of 330, 247 and 391 ppm, P2 and P4.

### Funding

The published formula is a Binance style premium plus interest, clamped to 0.05 % around the interest rate and then to a cap and floor, recalculated once a minute, see [`fees.md`](./fees.md) section 6.
The live `funding_rate` equalled Binance USD-M `lastFundingRate` on 57, 56 and 56 of 58 shared perpetuals in three reads, including 7 of 7, 6 of 7 and 6 of 7 contracts whose rate was not a round clamp value, P4.
The one miss among those was `XAUUSDT` both times, 0.0000698 against 0.00007018 and 0.00006773 against 0.00006761, P4.
So the published rate follows Binance's current estimate with up to a minute of lag.
`funding_rate` and `pre_funding_rate` were always equal and changed at most once in 60 polls, so the published number is the running estimate for the upcoming settlement and not the last settled one.
Against the newest settled rate, the ticker rate was equal on 53 and 52 of 66 contracts, mostly because the rate sits at 0.0001 or 0.00005, P3.
Whether the charged rate is the last estimate before the settlement, or a separate calculation, was not captured, since this survey never waits for a settlement instant.

### How often each number changed

60 polls one second apart over the 66 live perpetuals, at 06:39 and 07:01 UTC, P2.

| field | changes per contract, min, median, max, 06:39 | 07:01 | contracts that never changed |
|---|---|---|---|
| `index.close` | 0, 8, 46 | 0, 11, 50 | 7 and 5 |
| `tag.close` | 0, 19, 51 | 0, 25, 49 | 1 and 1 |
| `market.close` | 8, 31, 50 | 7, 34, 52 | 0 and 0 |
| `funding_rate` | 0, 0, 1 | 0, 0, 1 | 64 and 55 |
| `funding_next_time` | 0, 0, 0 | 0, 0, 0 | all |

On `BTCUSDT` the index changed 13 and 37 times and the mark 41 and 39 times.
No contract's funding rate changed more than once in 60 polls, which fits "calculated once per minute".
The reader refuses an index or mark that moved more than 1,000 ppm in one poll, see [`../../implemented/2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section 4, and a one second poll is fast enough here.

## 5. REST book snapshot

`GET /notification/swap/{symbol}/orderbook?interval=step0`, documented with `interval` step0 to step3 and a limit of 20 per 2 s per IP, S1.

| request | levels, bids and asks, pass 1 | pass 2 | first price gap | size, pass 1 |
|---|---|---|---|---|
| no `interval` | 382 and 381, answered as `step0` | 407 and 425 | 0.1, the tick | 13,976 bytes |
| `step0` | 382 and 381 | 402 and 428 | 0.1 | 13,968 bytes |
| `step1` | 328 and 334 | 357 and 396 | 1 | 10,954 bytes |
| `step2` | 183 and 182 | 213 and 222 | 10, then 20 | 6,312 bytes |
| `step3` | 95 and 101 | 104 and 113 | 100 | 3,503 bytes |
| `step9` | HTTP 200, `"data":[]` | same | | 114 bytes |
| `ETHUSDT` step0 | 500 and 500 | 500 and 500 | | |
| `ACEUSDT` step0 | 81 and 56 | 82 and 58 | | |
| `BTCUSD` step0 | 317 and 327 | 384 and 363 | | |
| `XAUUSDT` step0 | 29 and 31 | 29 and 29 | | |
| `1000SATSUSDT` step0 | 87 and 77 | 86 and 76 | | |

All on `BTCUSDT` unless named, P5 `book`.
`step1` to `step3` aggregate prices into coarser buckets, 1, 10 and 100 on `BTCUSDT` whose tick is 0.1, as the first price gaps show, so only `step0` gives exact levels.
Bids are descending and asks ascending on every reply, and every size on the five contracts checked for it was an integer string.
The reply carries `seqId`, `id`, `version`, `ts`, `type`, `product_name` and `interval`, the same header as a socket frame, and the socket frame with the same `seqId` was identical level for level, see [`websocket.md`](./websocket.md) section 4.
Two reads back to back carried `ts` 100 ms apart in pass 1 and the same `ts` in pass 2, with `cf-cache-status: DYNAMIC` and no `cache-control`, so the book is not cached at the edge and follows the socket's 100 ms publication.

## 6. Rate limits and errors

| scope | documented limit | source |
|---|---|---|
| swap and spot market data, including the bulk ticker and the book | 20 per 2 s, by IP | S1 |
| public data: `/v2/time`, `/v2/coins`, `/v2/products` | 10 per s | S1 |
| order placement and cancel | 3 per s | S1 |
| current orders, positions, balances | 10 per s | S1 |

The web client maps error code 100429 to "Too many requests. Please try again later.", S4.
No limit was reached, so the HTTP status a limit returns and whether it carries `Retry-After` are Not verified.
The bulk ticker reply carries no rate limit header, P5 `errors`.

| request | status | body |
|---|---|---|
| `/notification/swap/NOPEUSDT/orderbook?interval=step0` | 200 | `{"code":200,"interval":"step0","msg":"success","status":"ok","ts":…,"type":"swap.orderBook","data":[]}` |
| `/notification/swap/NOPEUSDT/ticker` | 200 | a full ticker object of zeros, `"ch":"swap.NOPEUSDT.detail"` |
| `/notification/swap/BTC-USDT/ticker` | 404 | `404 page not found` as text |
| `/v2/nope` | 404 | `{"code":404,"msg":"Not Found"}` |
| `/v2/info/swap/history/funding` without `symbol` | 422 | `{"code":100400,"msg":"Invalid parameters","data":null}` |

An unknown symbol is not an error on the market data paths, so a poller must check for an empty `data` or a zero index itself.

## 7. Server time and clock offset

`GET /v2/time` answered `{"code":200,"msg":"success","data":{"server_time":1790145707626}}`, server time in ms, S1.
Five reads gave offsets of +6, -2, +3, +6 and +5 ms against this host, taken at the midpoint of round trips of 52 to 78 ms, and +1, +2, +3, +3 and +1 ms over round trips of 43 to 48 ms in pass 2, P5.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api-v2.uzx.com/notification/swap/tickers` | one documented call carries index, mark, rate and next settlement for every perpetual |
| interval column | `GET https://api.uzx.com/v2/info/swap/history/funding?symbol=<id>&page=1&size=1` per tracked contract at boot and once an hour, keeping `cycle` | the bulk call has no interval, and this undocumented call is the only public source of it |
| cadence | 1,000 ms, the default | median 70 to 95 ms, max 238 ms over 180 polls, 2 of the 20 per 2 s budget |
| row mapping | section 3, key `symbol` | |
| skip | rows not in the catalog, a zero `index.close`, or no `funding_next_time` | the 8 delisted rows |
| skip | `status` other than 1 in `/v2/info/swap-usdt/symbols` | status 2 is "Trading suspended" |
| deny list input | `UZXUSDT` | the venue's own token, with a basket that is likely UZX only |
| funding caution | treat the rate as Binance's `lastFundingRate` with up to a minute of lag | a UZX leg's funding then says nothing about the UZX premium, section 4 |
| rate limit pause | `rateLimitPauseMs` 2,000 | the window is 2 s and no `Retry-After` was seen |
| alternative | the socket channel `swap.overview`, one subscription, one push a second | the same fields for the 66 live rows, see [`websocket.md`](./websocket.md) section 2 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | UZX API documentation, English, `last-modified` 2026-06-15 | https://www.uzx.com/v2/api/docs/en/index.html | 2026-09-23 | UZX, global | hosts, calls, fields, enums, limits, sections 1 to 7 |
| S4 | UZX web client bundle, English strings | https://www.uzx.com/assets/js/index-Fr-xn0lT.js | 2026-09-23 | UZX, global | order limit rule, error 100429, the `/v2/info` and `/content` routes, sections 1, 4, 6 |
| P1 | `rest-probe.mjs catalog`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:37, 07:00 and 07:07 UTC | this host, Canadian VPN exit | sections 1 to 3 |
| P2 | `rest-probe.mjs anchor`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:38, 06:39 and 07:01 UTC | this host | sections 1, 3, 4 |
| P3 | `rest-probe.mjs funding`, two passes | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:40 and 07:02 UTC | this host | sections 3, 4 |
| P4 | `rest-probe.mjs compare`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:42, 06:43 and 07:03 UTC | this host and Binance USD-M | sections 2, 4 |
| P5 | `rest-probe.mjs book` and `errors`, two passes | [`rest-probe.mjs`](../../../scripts/probes/venues/uzx/rest-probe.mjs) | 2026-09-23 06:41 and 07:03 UTC | this host | sections 5 to 7 |
