# Delta Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 21:12 and 21:42 Pacific time, which is 2026-09-23 04:12 to 04:42 UTC.

This profile covers the public REST API v2 of Delta Exchange global (CCXT id `delta`) for its one perpetual family, the catalog and the anchor in detail.
Every measurement below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs), and each is cited by mode as P1 to P6 in section 9.
Access results are from this laptop's Surfshark WireGuard exit, which geolocates to Canada, and every public call answered without a refusal.
The global documentation host no longer resolves, so the documentation of record is its Wayback Machine capture of 2026-01-30, S1, as [`websocket.md`](./websocket.md) explains.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.delta.exchange`, a CNAME to `d3d5ujn5lkulpt.cloudfront.net`, four IPv4 addresses in `99.86.101.0/24` and eight IPv6 addresses on 2026-09-23 UTC, P1 |
| edge | CloudFront point of presence `SEA900-P13`, from the `x-amz-cf-pop` header, P1 |
| origin | AWS Tokyo, S1 section "Data Centers" |
| first request | 408 and 411 ms for `GET /v2/tickers/BTCUSDT` in two runs, P1 |
| warm request, edge miss | 340 to 456 ms on `/v2/tickers/BTCUSDT` over two runs, P1, and 350 and 348 ms at the median, 384 and 502 ms at most over two runs of 30 bulk ticker polls with a nonce, P3 |
| warm request, edge hit | 14 to 23 ms, and the reply is the one cached up to 2 s earlier, P1 and P3 |
| server time spent | 4.0 to 5.8 ms between the `request-in-time` and `request-out-time` headers, P1 |

The separate Delta Exchange India API, `api.india.delta.exchange`, is another CloudFront name and answered from this host with 200, P2 and P6.

## 2. Catalog

### The instruments call

`GET https://api.delta.exchange/v2/products` returns every product in one page, with `meta.limit` 3000, P2.
It held 414 rows, 1.42 MB, in 1,202 ms at 04:13 UTC, and 404 rows, 1.39 MB, in 1,022 ms at 04:33 UTC, as options were listed and binary options expired.
The table is the 04:13 reading, and at 04:33 the binary rows were 6 calls and 6 puts, all operational, and one call and one put were `disrupted_post_only`.

| `contract_type` | rows | `state` | `trading_status` |
|---|---:|---|---|
| `call_options` | 190 | live | operational |
| `put_options` | 188 | live | operational |
| `binary_call_options` | 12 | live | 6 operational, 6 `disrupted_post_only` |
| `binary_put_options` | 12 | live | 6 operational, 6 `disrupted_post_only` |
| `perpetual_futures` | 6 | live | operational |
| `spot` | 6 | live | operational |

The active perpetual count is 6, all quoted and settled in USDT, P2.
No dated future was listed.
The documented `state` values are `upcoming`, `live`, `expired` and `settled`, and `trading_status` adds `disrupted_cancel_only` and `disrupted_post_only` during a disruption or an auction, S1.

| symbol | id | `contract_value` | tick | index | funding interval | launched |
|---|---:|---|---|---|---|---|
| `BTCUSDT` | 139 | 0.001 BTC | 0.5 | `.DEXBTUSDT` | 28,800 s | 2020-04-04 |
| `ETHUSDT` | 176 | 0.01 ETH | 0.05 | `.DEETHUSDT` | 28,800 s | 2020-04-22 |
| `SOLUSDT` | 5401 | 1 SOL | 0.0001 | `.DESOLUSDT` | 28,800 s | 2021-04-09 |
| `XRPUSDT` | 187 | 1 XRP | 0.0001 | `.DEXRPUSDT` | 28,800 s | 2020-04-27 |
| `DOGEUSDT` | 3316 | 100 DOGE | 0.000001 | `.DEDOGEUSDT` | 28,800 s | 2021-01-29 |
| `PAXGUSDT` | 277715 | 0.001 PAXG | 0.01 | `.DEPAXGUSDT` | 14,400 s | 2026-01-08 |

The funding interval is `product_specs.rate_exchange_interval`, P2.
CoinGecko's derivatives API listed `delta_futures` with `number_of_perpetual_pairs` 8 and returned 5 tickers on 2026-09-23 UTC, without PAXG, S5.
The 24 h `turnover_usd` in the bulk ticker was 4,874,512 on ETHUSDT, 1,472,407 on BTCUSDT, 117,455 on SOLUSDT, 585 on PAXGUSDT and 0 on XRPUSDT and DOGEUSDT, P3.

The Delta Exchange India platform lists 220 live perpetuals, all quoted and settled in `USD`, on its own host, P2.
It serves residents of India only, see [`fees.md`](./fees.md) section 1, and CCXT 4.5.68 has no class for it.

### How CCXT 4.5.68 maps it

`fetchMarkets` calls `publicGetProducts` once with no parameters, at `server/node_modules/ccxt/js/src/delta.js` line 664, and loaded 390 and 392 markets in 963 and 954 ms in two runs, of which 6 are swaps and all 6 active, P2.

| CCXT field | source, `delta.js` line | value on 2026-09-23 UTC |
|---|---|---|
| `id` | `symbol`, line 859 | `BTCUSDT` and the other five, identical to the socket `sy`, the ticker `symbol` and the REST book path |
| `type`, `swap` | `contract_type === "perpetual_futures"`, lines 868 and 909 | `swap` on 6 |
| `active` | `state === "live"`, line 929 | true on 6 |
| `linear` | `settle === quote`, line 883 | true on 6 |
| `contractSize` | `contract_value`, lines 874 and 935 | 0.001, 0.01, 1, 1, 100, 0.001, as the table above |
| `taker`, `maker` | `taker_commission_rate`, `maker_commission_rate`, lines 933 and 934 | 0.0001 on BTC and ETH, 0.0002 on PAXG, 0.0003 on SOL, XRP and DOGE |
| `precision.amount` | 1 contract, line 881 | 1 |

The fee field CCXT reads is the rate for orders placed outside the API, see [`fees.md`](./fees.md) section 8.

### Size unit, pairs listed twice, and price scale

The book size unit is contracts, and `contractSize` is the coin amount of one contract, so the engine's size multiplier is right, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice among the active swaps, P2.
No contract is quoted per 10 or per 1000 units, so no price scale is needed.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /v2/tickers?contract_types=perpetual_futures` | `spot_price` | `mark_price` | `funding_rate`, percent per interval | absent | absent | 6,883 to 6,891 bytes, 6 rows | 60 polls through the edge in three runs: median 45, 18 and 34 ms, p90 445, 357 and 366 ms, max 468, 451 and 452 ms. 30 polls with a nonce in two runs: median 350 and 348 ms, max 384 and 502 ms |
| `GET /v2/products?contract_types=perpetual_futures` | | | | `product_specs.rate_exchange_interval`, seconds | absent | 37,162 bytes, 6 rows | 481 ms once |

No REST call carries the next settlement instant.
The `funding_rate` socket channel does, as `nfr` in µs, and it read 2026-09-23 08:00 UTC on all six perpetuals at 04:18 and 04:39 UTC, including PAXGUSDT on its 4 h interval, see [`websocket.md`](./websocket.md) section 6.
The settlement grid is 00:00, 08:00 and 16:00 UTC for 8 h contracts, S2, so `nextFundingAt` can be computed as the next multiple of the interval after the Unix epoch.

The ticker reply also carries `quotes.best_bid`, `quotes.best_ask` and `mark_basis`, which S1 does not define.
`mark_basis` equalled the mark's premium over `spot_price` on 4 of 6 rows in one poll and on 0 of 6 in another, so it is not that premium read at the same instant, P3.
`quotes.impact_mid_price` was null on all six, and the `time` field read about 24 h before the fetch, so neither is a reading of the moment, P3.

### The reply is a snapshot republished every 2.5 to 3.2 s and cached for 2 s

The bulk ticker answers `cache-control: public,max-age=2`, and 31, 40 and 31 of 60 one-second polls were served by the edge in three runs, P3.
The row `timestamp`, in µs, changed 24, 19 and 23 times over those 60 polls, and 12 times in each of two runs of 30 polls that carried a `nonce` query parameter and were all edge misses, P3.
So the origin rebuilds the snapshot every 2.5 to 3.2 s.
The `timestamp` was 2,261, 3,044 and 2,396 ms old at arrival at the median through the edge, and 3,745, 5,466 and 4,126 ms at most.
With the nonce it was 806 and 607 ms old at least, 2,160 and 1,842 ms at the median, and 3,261 and 2,981 ms at most.
The engine stamps a reading on arrival, so it would treat a reading up to 5.5 s old as fresh.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `spot_price` | decimal string | `Number()` |
| `mark` | `mark_price` | decimal string, never 0 on 6 rows | `Number()` |
| `fundingRate` | `funding_rate` | decimal string in percent per interval: `"0.0020127394718774602"` is 0.0000201 as a fraction | `Number() / 100`, as CCXT does at `delta.js` line 2801 |
| `fundingIntervalHours` | `product_specs.rate_exchange_interval` from `/v2/products` | integer seconds: 28800, 14400 | divide by 3,600 |
| `nextFundingAt` | computed | | `Math.ceil(now / intervalMs) * intervalMs` |

The funding rate is per interval, not per 8 h.
PAXGUSDT on 4 h read `funding_rate` 0.003389 while the legacy socket's `funding_rate_8h` read twice that, 0.006778, see [`websocket.md`](./websocket.md) section 6.

## 4. Anchor semantics

### Index

Each perpetual's `spot_index` in the product row names its basket, and `GET /v2/indices` returns all 20 indices with the same fields in 12,259 bytes, P2 and P3.

| index | `price_method` | constituents, equal weight |
|---|---|---|
| `.DEXBTUSDT` | `orderbook` | binance, okex, bybit |
| `.DEETHUSDT` | `orderbook` | binance, okex, bybit |
| `.DEXRPUSDT` | `orderbook` | binance, okex |
| `.DESOLUSDT` | `ltp` | binance, okex |
| `.DEDOGEUSDT` | `ltp` | okex, binance |
| `.DEPAXGUSDT` | `ltp` | binance, kucoin |

Every perpetual index has `index_type` `spot_pair`, and none includes Delta's own markets, P2.
The only index built on Delta itself is `.DEDETOUSDT`, `price_method` `local`, which no perpetual uses.
The methods `orderbook` and `ltp` are not defined in S1, and a reading of `ltp` as last traded price is an inference.
BTCUSDT's index carries `impact_size` settings of 5,000 to 150,000, which suggests an impact price on the constituent books, and that too is an inference.
The socket republishes the index every 250 ms on BTC, ETH and XRP, and every 1 s on PAXG, see [`websocket.md`](./websocket.md) section 2.

### Mark

The mark is the index plus a fair basis, S3.
The fair basis starts from the impact mid price, the average fill price of a typical long and a typical short of `impact_size` contracts.
`%AnnualisedBasis = (Impact Mid Price / Index - 1) * (365 * 86400 / time to expiry)`, with the time to expiry always 8 h for a perpetual, computed once every 5 s and not updated while the impact spread exceeds the maintenance margin, S3.
`%FairBasis` is the moving average of the 12 latest values, so it spans 60 s, and it is bounded by hard limits per contract, S3.
`basis_factor_max_limit` in the product row is documented as the "Maximum value for annualized basis", S1.
Over the 8 h time to expiry that bounds the mark's premium over the index at 10.95 × 8 / 8,760, which is 1 %, on BTCUSDT and ETHUSDT, 2 % on XRPUSDT and DOGEUSDT, 3 % on PAXGUSDT and 52 % on SOLUSDT, a derivation from the product rows of P2.

Two consequences for the engine.
The mark's premium is a 60 s average, so a dislocation of the Delta perpetual shows in the mark only as it enters that average.
A premium beyond the cap reads as the cap, which is the capped mark shape that [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) warns of, and on BTCUSDT and ETHUSDT the cap is 1 %.
The observed premium was far inside every cap: −403 to −418 ppm on BTCUSDT, ETHUSDT, SOLUSDT and PAXGUSDT, −85 ppm on XRPUSDT and −672 ppm on DOGEUSDT at 04:13 UTC, and −166 to −521 ppm on all but XRPUSDT, which read −37 ppm, at 04:35 UTC, P3.
The legacy `mark_price` frame carries the annualised basis itself, `"annualized_basis":"-0.4722…"` on BTCUSDT, which is −431 ppm over 8 h, see [`websocket.md`](./websocket.md) section 6.

### Funding

The rate is `Avg. Premium + clamp(Interest Rate − Avg. Premium, 0.05 %, −0.05 %)`, with the premium `(Mark − Index) / Index` measured every minute and the interest rate 0.01 % per 8 h, S2.
`product_specs.funding_clamp_value` is 0.05 and `funding_twap_linear_weighted_enabled` is true on all six, P2.
The cap is `annualized_funding`, documented as the "Maximum allowed annualized funding rate", S1, which gives 1 % per 8 h on BTCUSDT and ETHUSDT, 2 % on XRPUSDT and DOGEUSDT, 18.3 % on SOLUSDT and 2 % per 4 h on PAXGUSDT, a derivation from P2.

The published `funding_rate` is a running estimate that moves during the interval.
It changed once in 60 one-second polls on five of six perpetuals, and XRPUSDT sat at exactly 0.01 %, the interest rate, P3.
The socket republishes it about once a minute, and on the legacy URL its `predicted_funding_rate` equalled `funding_rate` on every frame, see [`websocket.md`](./websocket.md) section 2.
The rate history is `GET /v2/history/candles?resolution=1h&symbol=FUNDING:<symbol>&start=<s>&end=<s>`, S1, and it is flat within an interval and steps at the settlement, P4.

| perpetual | history 16:00 to 00:00 UTC | history from 00:00 UTC | formula over 16:00 to 00:00 from `MARK:` and index candles | formula from 00:00 to 04:19 and to 04:37 | published at 04:19 and 04:37 |
|---|---|---|---|---|---|
| BTCUSDT | −0.00064617 % | −0.00024801 % | −0.002623 % | 0.001863 % and 0.001717 % | 0.002023 % and 0.002191 % |
| ETHUSDT | 0.00476099 % | 0.00888175 % | 0.008548 % | 0.009451 % and 0.009234 % | 0.009486 % and 0.009419 % |

The recompute uses one-minute closes and an unweighted mean, so it lands near but not on the linearly weighted TWAP the product rows name, P4.
The published rate stays within 0.0005 % of the formula over the running interval on both perpetuals.
The history value from 00:00 sits near the formula over the interval that ended at 00:00 on ETHUSDT, and only loosely on BTCUSDT, whose average premium sat near the −0.05 % edge of the clamp where the rate is most sensitive to how the average is taken.
S2 says "At these times, the funding to be exchanged is computed by averaging the premium that was applicable for the past 8 hours", which makes the published rate the one charged at the next settlement.
The worked example in S2 instead applies the 08:00 to 16:00 average to the 16:00 to 00:00 interval, which would make the history value the one charged next.
The two readings disagree, and the settlement instant itself was not captured.
The first reading is the one the running estimate and the socket's equal `funding_rate` and `predicted_funding_rate` support.

### Rate across a settlement

The one-minute `FUNDING:BTCUSDT` history read −0.00064617 % through 23:59 UTC and −0.00024801 % from 00:00 UTC on 2026-09-23, and the hourly `FUNDING:PAXGUSDT` history stepped from 0.005 % to 0.00379825 % at the 04:00 UTC candle, P4.
PAXGUSDT's 0.005 % per 4 h is the 0.01 % per 8 h interest rate scaled to its interval.
Funding moved from a minute-by-minute exchange to three settlements a day at 12:00 UTC on 2025-09-08, S2.
What the ticker shows in the seconds around a settlement was not captured, because no probe waited for one.

### How often each number changed

Over 60 one-second polls through the edge, in three runs, P3.

| perpetual | `spot_price` changes | `mark_price` changes | `funding_rate` changes | best bid or ask changes |
|---|---:|---:|---:|---:|
| BTCUSDT | 18, 19, 21 | 24, 19, 23 | 1, 1, 1 | 5, 15, 15 |
| ETHUSDT | 23, 19, 21 | 24, 19, 23 | 1, 1, 1 | 8, 17, 16 |
| SOLUSDT | 18, 19, 15 | 24, 19, 23 | 1, 1, 1 | 7, 9, 8 |
| XRPUSDT | 20, 15, 20 | 24, 19, 23 | 0, 0, 0 | 11, 12, 11 |
| DOGEUSDT | 20, 12, 21 | 24, 19, 23 | 1, 1, 1 | 7, 11, 10 |
| PAXGUSDT | 1, 5, 1 | 24, 19, 23 | 1, 1, 1 | 2, 0, 0 |

The mark changed on every republish, and the number of republishes is the ceiling on every column.

## 5. REST book snapshot

`GET /v2/l2orderbook/{symbol}?depth=<n>` returned 5 levels per side for `depth=5` and 20 for the default, 20, 50, 100 and 1000, so 20 is the ceiling, in 108 to 380 ms over two runs, P5.
Bids come descending and asks ascending.
Each level is `{"size": 230, "depth": "2.3E+2", "price": "86819.5"}`, with `size` a JSON number of contracts, `price` a string and `depth` a cumulative string that can use exponent notation.
The reply has `symbol`, `buy`, `sell` and `last_updated_at` in µs with millisecond precision, and no sequence number, so it cannot be aligned with the socket's `seq`.
It is not cached at the edge, `cache-control: max-age=0, private, must-revalidate`, and ETHUSDT's `last_updated_at` advanced 1 and 3 times over six reads 400 ms apart in two runs, which is the book's own pace, P5.
The socket snapshot is deeper and sequenced, so the feed has no use for this call.

## 6. Rate limits and errors

Unauthenticated requests are throttled per IP with a quota of 10,000 per fixed 5 minute window, S1.
`GET /products`, the order book and the tickers weigh 3, and an endpoint missing from the weight table weighs 1, S1.
A breach answers 429 with an `X-RATE-LIMIT-RESET` header holding the milliseconds until the window resets, S1.
No public reply in the runs carried a rate limit header, and no limit was provoked, P6.
A one-second poll of the bulk ticker spends 900 of the 10,000, and a products call once a minute adds 15.

| request | status | body |
|---|---|---|
| `/v2/l2orderbook/NOPEUSDT` | 400 | `{"error":{"code":"invalid_contract"},"success":false}` |
| `/v2/products/NOPEUSDT` | 400 | `{"error":{"code":"invalid_contract"},"success":false}` |
| `/v2/tickers/NOPEUSDT` | 200 | `{"success":true,"result":null}` |
| `/v2/tickers?contract_types=nope` | 400 | `bad_schema` listing the allowed contract types |
| `/v2/l2orderbook/BTCUSDT?depth=abc` | 400 | `{"error":{"code":"bad_schema","context":{"schema_errors":[{"code":"validation_error","message":"Should be an integer","param":"depth"}]}},"success":false}` |
| `/v2/history/candles` without `start` and `end` | 400 | `bad_schema`, "start is required" and "end is required" |
| `/v2/nope` | 404 | `Not Found` as plain text |
| `api.india.delta.exchange/v2/tickers/BTCUSDT` | 200 | `{"success":true,"result":null}`, the India platform has no such symbol |

An unknown query parameter such as `nonce` is accepted on `/v2/tickers`, P3.

## 7. Server time and clock offset

No server time call is documented in S1.
Every origin reply carries `request-in-time` and `request-out-time` headers in µs, P1.
`request-in-time` was 90 to 145 ms ahead of the midpoint of the local send and receive on eleven edge misses over two runs, against a round trip of 340 to 456 ms, P1.
An edge hit returns the cached headers, which read 795 ms behind.
The offset cannot be separated from the asymmetry of the edge to Tokyo path at that round trip, so the clock is known only to within about 200 ms.
The `Date` header matched the local clock to the second.
The engine stamps on arrival, so the offset matters only for judging the reply `timestamp`, section 3.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.delta.exchange/v2/tickers?contract_types=perpetual_futures&nonce=<ms>` | one call carries index, mark and rate for all six, and the nonce skips the 2 s edge cache |
| second call | `https://api.delta.exchange/v2/products?contract_types=perpetual_futures` once at boot and then every few minutes | the only REST source of the funding interval |
| interval | 1,000 ms, the default | median 348 and 350 ms and max 502 ms uncached, and 900 of the 10,000 weight per window |
| row mapping | section 3, key `symbol`, `funding_rate / 100`, `nextFundingAt` computed from the interval | the ticker has neither interval nor next settlement |
| freshness | treat a reading as up to about 3.3 s old even uncached, and flag it in the design | the origin republishes every 2.5 to 3.2 s and its `timestamp` was 0.8 to 3.3 s old at arrival |
| skip | rows whose `product_trading_status` is not `operational` | a disrupted book is cancel only or post only, S1 |
| do not read | `quotes.impact_mid_price`, `time` | null and a day old, section 3 |
| rate limit pause | `rateLimitPauseMs` from `X-RATE-LIMIT-RESET` when present, otherwise 300,000 | the window is a fixed 5 minutes, S1 |
| deny list input | none | no perpetual index contains Delta's own market |
| mark caveat | the fresh gate reads a 60 s averaged premium capped at 1 % on BTC and ETH | section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Delta Exchange Global API documentation, Wayback Machine capture of 2026-01-30 | https://web.archive.org/web/20260130043054/https://docs-global.delta.exchange/ | 2026-09-22 | Delta Exchange global | products, tickers, indices, candles, order book, product field descriptions, rate limits, data center, sections 1 to 8 |
| S2 | Perpetual Contracts Guide | https://guides.delta.exchange/delta-exchange-user-guide/derivatives-guide/docs | 2026-09-22 | Delta Exchange global, titled "Faida - User Guide & Rule Book" | funding formula, times, interest rate, settlement snapshot, the 2025-09-08 change, section 4 |
| S3 | Fair Price Marking | https://guides.delta.exchange/delta-exchange-user-guide/trading-guide/fair-price-marking | 2026-09-22 | Delta Exchange global | mark formula, 5 s cadence, 12 sample average, hard limits, section 4 |
| S4 | Delta Exchange India API documentation | https://docs.delta.exchange/ | 2026-09-22 | Delta Exchange India | the note that `api.delta.exchange` belongs to Delta Global, sections 1 and 2 |
| S5 | CoinGecko API, `derivatives/exchanges/delta_futures` and `exchanges/delta_spot` | https://api.coingecko.com/api/v3/derivatives/exchanges/delta_futures?include_tickers=all | 2026-09-22 | CoinGecko | listing and volume context, section 2 |
| S6 | CCXT 4.5.68 `delta.js` | `server/node_modules/ccxt/js/src/delta.js` | 2026-09-22 | CCXT | market mapping and funding conversion, sections 2 and 3 |
| P1 | `rest-probe.mjs host` at 04:12 and 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 7 |
| P2 | `rest-probe.mjs catalog` at 04:13 and 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2 and 4 |
| P3 | `rest-probe.mjs anchor` at 04:13, 04:25 and 04:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 4 and 6 |
| P4 | `rest-probe.mjs funding` at 04:14, 04:19 and 04:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P5 | `rest-probe.mjs book` at 04:20 and 04:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P6 | `rest-probe.mjs errors` at 04:20 and 04:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/delta/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
