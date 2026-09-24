# WazirX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 05:08 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures REST API of WazirX, which has no CCXT class, that a catalog, an anchor poller and a book resync would use, for both perpetual families.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs), run from `server/`, and each run read Binance USD-M in the same second for comparison.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.
The documentation is the futures part of `https://docs.wazirx.com/`, S1, which this host read directly.

## 1. Host and latency from this machine

| item | value | run |
|---|---|---|
| base URL | `https://api.wazirx.com`, futures under `/fapi/v1`, spot under `/sapi/v1` | S1 |
| resolved address | `api.wazirx.com` is a CNAME of `wrx-1450055807.ap-south-1.elb.amazonaws.com`, an AWS load balancer in Mumbai, on `65.2.59.88` and `13.202.152.165`. The server header is `openresty` | `dig` and `latency` P1 |
| DNS lookup | 11.8 to 13.0 ms | `latency` P1, two runs |
| cold `/fapi/v1/time`, new TLS connection | 804 to 860 ms, median 830 and 818 ms in two runs of 5 | `latency` P1 |
| warm `/fapi/v1/time` | median 268.5 and 267.8 ms over 10 calls each, with one call per run near 803 ms | `latency` P1 |
| warm bulk `/fapi/v1/premiumIndex`, 96.5 KB | median 274 and 284 ms over 45 polls each, first poll 1,341 and 1,447 ms | `anchor` P2 |
| access | every public call answered, no geoblock, from the Canadian VPN exit | all runs |

The round trip of about 268 ms is the distance from this host to Mumbai.

## 2. Catalog

### The instruments call

`GET /fapi/v1/exchangeInfo` returned 386,491 bytes in 1,882 to 1,935 ms with 450 contracts, S1 and `catalog` P1.

| field | meaning | observed |
|---|---|---|
| `symbol` | uppercase id, the key of every REST call | `BTCUSDT`, `BTCINR`, always `baseAsset` plus `quoteAsset` |
| `contractType` | | `PERPETUAL` on 450 of 450 |
| `quoteAsset`, `marginAsset` | quote and margin | 229 `INR`/`INR`, 221 `USDT`/`INR` |
| `status` | absent | 0 of 450 carry it, so a listed contract is a live one, and a delisted one leaves the list |
| `orderTypes` | | `MARKET`, `LIMIT` on 450 of 450 |
| `maxLeverage` | | 10 to 150, with 150 on 4 contracts |
| `pricePrecision`, `quantityPrecision` | decimals | `BTCUSDT` 1 and 3, `BTCINR` 0 and 3, `ETHUSDT` 2 and 3 |
| `filters` | `limit_qty_size`, `market_qty_size`, `max_num_orders`, `min_notional` | `BTCUSDT` minimum 0.001, `min_notional` 115 |
| `categories` | ids into a top level `categories` list | 9 categories, among them Global Markets, Metals and Energy |

The reply also carries `assets` INR and USDT and `conversionRates`, where `INR_MARGIN_USDT` and `INR_SETTLEMENT_USDT` are 102.
That is the fixed rate at which a USDT-quoted contract's margin and P&L are counted in INR, which the launch post describes, S2.
`GET /fapi/v1/premiumIndex` and `GET /fapi/v1/ticker/24hr` return the same 450 symbols.

### The pairs are Binance USD-M perpetuals

| check | result | run |
|---|---|---|
| each symbol as a Binance symbol, with `<base>USDT` for an INR contract | 450 of 450 are Binance USD-M contracts in status `TRADING`, 393 of type `PERPETUAL` and 57 `TRADIFI_PERPETUAL` | `catalog` P1, two runs |
| USDT 24 h ticker open, high and low against Binance | equal on 220, 221 and 221 of 221 in three reads | `catalog` P1 |
| USDT 24 h ticker `volume` against Binance `quoteVolume` | equal within 0.2 % on 221 of 221, so WazirX reports Binance's quote volume | `catalog` P1 |
| INR price against the Binance price | a fixed multiplier per contract, 95.00 to 95.60 on the 24 h open price: 95.00 to 95.05 on most of the 229, 95.55 on BTC, 95.60 on ETH, 95.40 on SOL, 95.50 on BNB | `catalog` P1, and a one-off ticker pair at about 05:01 UTC, P5 |
| `markPrice` against Binance | `BTCUSDT` 87178.2 on both at 04:35 and 86885.7 against 86885.60489130 at 05:08, `ETHUSDT` 2784.99 against 2784.9814, so Binance's mark rounded up to `pricePrecision`, upward in all six pairs that differed | `catalog` P1 |
| `indexPrice` and `estimatedSettlePrice` against Binance | within 200 ppm on 347, 335 and 384, and on 373, 377 and 378, of 450 in three reads, with the rest explained by tick rounding and the read gap of about 2 s | `catalog` P1 |
| `nextFundingTime` against Binance | equal on 450 of 450 in three reads | `catalog` P1 |
| `lastFundingRate` against Binance | equal on only 109, 120 and 108 of 450, see section 4 | `catalog` P1 |
| book against Binance | Binance's top 20 sizes by rank on a widened, gap free price grid | [`websocket.md`](./websocket.md) section 4 |
| `!ticker@arr` trade ids | `F`, `L` and `n` near 485 million and 539 thousand for ETHFI, Binance's scale | [`websocket.md`](./websocket.md) section 6 |

The terms say the crypto-to-crypto services were "previously operated by Binance since November 2019", see [`fees.md`](./fees.md) section 1.
No WazirX document says where futures orders execute, so that Binance is the source is an inference from the wire.
The INR multiplier is not the spot USDT-INR price, which read 99.11 at 04:59 UTC, and not the margin rate of 102.

### How the engine's catalog would map it

| engine need | WazirX |
|---|---|
| CCXT `loadMarkets` | no CCXT class exists, see [`fees.md`](./fees.md) section 8, so a catalog would be built from `/fapi/v1/exchangeInfo` |
| `rawMarketId` | the REST and anchor key is `BTCUSDT`, while the socket spells the stream `btcusdt@depth` and `data.s` `btcusdt`. A feed upper-cases the stream symbol |
| `contractSize` | 1, sizes are base coins, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | yes for both families, USDT or INR quoted, INR settled |
| `active` | every listed contract, since there is no status field |
| a pair listed twice | yes: 197 bases have both an INR and a USDT contract, 32 are INR only and 24 USDT only |
| quote family | USDT contracts join the USDT family. INR is in no family, `server/src/engine/cluster/quoteFamily.ts` lines 4 and 5, so an INR contract would never cluster |
| price scale | 14 contracts carry the multiplier in the base, `1000PEPEUSDT`, `1000SHIBINR`, `1MBABYDOGEINR` and eleven more, as on Binance |
| deny list | Binance's own traps carry over, since the index, mark and book are Binance's |

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/premiumIndex` | `indexPrice` | `markPrice` | `lastFundingRate` | absent | `nextFundingTime`, Unix ms | 96.5 KB, 450 rows | 45 polls at 2 s: median 274 and 284 ms, p90 280 and 297 ms, max 1,341 and 1,447 ms on the first poll |
| `!markPrice@arr` on the socket | `i` | `p` | `r` | absent | `T`, Unix ms | 450 rows a frame | a frame every 1,015 to 1,017 ms median, [`websocket.md`](./websocket.md) section 2 |
| `GET /fapi/v1/ticker/24hr` | none | none | none | none | none | 102.6 KB, 450 rows | 1,621 and 1,651 ms first request |

One REST call carries four of the five `AnchorRow` columns for all 450 contracts, keyed by `symbol`.
Every row of one reply shares one `E`, equal to `time`, 137 and 142 ms median before the reply arrived, so the reply is a snapshot taken at the request.
The reply also carries `estimatedSettlePrice` and `T`, which equals `E`.
The single symbol form `?symbol=BTCUSDT` returns one object, S1.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `indexPrice` | decimal string, never 0 on 450 rows | `Number()` |
| `mark` | `markPrice` | decimal string, never 0 on 450 rows | `Number()` |
| `fundingRate` | `lastFundingRate` | decimal string with up to 9 decimals, a fraction per interval, and `"0.00000000"` on 27 contracts in one read | `Number()` |
| `fundingIntervalHours` | none | not published | from Binance `/fapi/v1/fundingInfo`, or from the step of `nextFundingTime` after a settlement |
| `nextFundingAt` | `nextFundingTime` | integer ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

At 04:35 and 04:56 UTC, 449 contracts read 08:00 UTC and `GINR` read 05:00 UTC, and at 05:08 `GINR` read 06:00 UTC, an hourly contract.
Binance runs 308 of the mapped contracts at 4 h, 141 at 8 h and 1 at 1 h, so 4 h and 8 h contracts share the 08:00 settlement and cannot be told apart from one read.

## 4. Anchor semantics

### Index

WazirX publishes no index formula and no basket call, S1.
The USDT index is Binance's index rounded up to the contract's tick: `87163.1` against Binance's `87162.99652174`, and `86928.9` against `86928.83673913`, and within 100 ppm on a median 130 and 129 of 221 USDT contracts per poll, with WazirX read about 140 ms stale.
The INR index is the USDT index times the contract's multiplier, `8325053` for `BTCINR` beside `87127.8` for `BTCUSDT` in the same reply, a ratio of 95.55.
So the basket is Binance's, and Binance's constituents call applies.

### Mark

WazirX publishes no mark formula, S1.
The mark is Binance's mark rounded up to `pricePrecision`, section 2, so every Binance clamp applies.
On a contract with a coarse tick the rounding alone moves the mark by up to one tick, and the tick of `HMSTRUSDT` is 538 ppm of its price.

### Funding

| item | value |
|---|---|
| formula | Not publicly specified, S1 |
| relation to Binance | near 0.9 or 1.1 times Binance's predicted rate: `ETHUSDT` 0.00011 against 0.0001, `SOLUSDT` 0.000076956 against 0.00007006, `BTCUSDT` 0.000036666 against 0.00004038 |
| common values | 0.000055 on 82 contracts, 0.00005 on 76 and 77, 0.00011 on 54, 0.000045 on 42 |
| INR against USDT twin | equal on 125 and 124 of 197 twins, and `DOGEINR` 0.00009 against `DOGEUSDT` 0.00011 |
| upcoming or settled | a running estimate for the upcoming settlement: `BTCUSDT` read 0.000037215 from 04:25 to 04:37 UTC, 0.000040194 at 04:49 and 0.000036666 from 04:56 to 05:00, none of them Binance's settled 0.00001021 at 00:00 UTC |
| update cadence | 0 changes on 450 of 450 contracts over each 90 s run, and at least two changes between 04:37 and 04:56 UTC |
| cap | Not publicly specified |

`funding` P4 and `anchor` P2.
The settlement instant itself was not captured, and no public funding history exists, section 6.

### How often each number changed

Over 45 polls 2 s apart, 44 intervals, per contract.

| number | median | p90 | max | `BTCUSDT` | `BTCINR` |
|---|---:|---:|---:|---:|---:|
| `markPrice` | 14 and 12 | 33 and 30 | 42 and 39 | 36 and 31 | 36 and 34 |
| `indexPrice` | 9 and 7 | 31 and 28 | 42 and 41 | 36 and 30 | 39 and 34 |
| `lastFundingRate` | 0 | 0 | 0 | 0 | 0 |
| `nextFundingTime` | 0 | 0 | 0 | 0 | 0 |

`E` was new on 45 of 45 polls, so the reply is not cached between polls.

## 5. REST book snapshot

| item | value | run |
|---|---|---|
| call | `GET /fapi/v1/depth?symbol=BTCUSDT`, lowercase `btcusdt` also accepted | S1, `book` and `errors` P3 |
| depth | 20 levels a side only. `limit` 5, 50, 100 and 500 each answered 400 `{"message":"limit does not have a valid value","code":1999}` | `book` P3 |
| level order | bids descending and asks ascending, 16 of 16 reads over two runs | `book` P3 |
| stamps | `E` equal to `T` on every read, and the documentation calls `T` "Last cached at". The reply arrived 131 and 137 ms median after `T` | `book` P3 |
| caching | 15 reads 1.5 s apart had 15 distinct `T`, and the touch took 5 and 4 distinct values over them. No `cache-control`, `age` or `etag` header | `book` P3 |
| size and time | 847 to 1,037 bytes, 270 to 275 ms | `book` P3 |
| coverage | answers for contracts the socket does not serve, such as `HMSTRUSDT` | `book` P3 |
| content | Binance's book widened and re-gridded, the same as the socket frame, see [`websocket.md`](./websocket.md) section 4 | `book` P3 |

## 6. Rate limits and errors

The futures docs say "Limits are applied per API key. Public market-data endpoints are limited per IP.", and list 60 requests per minute per endpoint for every endpoint except order entry, with 429 on excess, S1.
The general section adds 403 for a WAF violation, 418 for an automatic IP ban that scales "from 2 minutes to 3 days", and a `Retry-After` header on 418 and 429, S1.

| case | status | body |
|---|---|---|
| the 53rd `premiumIndex` call in 3 min 19 s, never more than 30 in one minute | status not captured | `{"message":"Too many api request","code":2136}` at 04:59:35 UTC, cleared by 05:00:36 |
| unknown symbol on `depth` | 400 | `{"message":"symbol does not have a valid value","code":3001}` |
| missing symbol on `depth` | 400 | `{"message":"symbol is missing, symbol does not have a valid value","code":1999}` |
| unknown symbol on `premiumIndex` | 400 | `{"code":3007,"message":"Selected contract is not valid."}` |
| unknown symbol on `ticker/24hr` | 400 | `{"code":3001,"message":"symbol does not have a valid value"}` |
| unknown path, including `/fapi/v1/fundingRate`, `/fapi/v1/fundingInfo`, `/fapi/v1/ticker/bookTicker` | 403 | an HTML page "403 Forbidden" from `openresty` |

None of the 400 and 403 replies carried `Retry-After`, and the headers of the code 2136 reply were not captured.
The code 2136 refusal came well under the documented 60 per minute, so the public per IP limit on `premiumIndex` is lower than the published per key limit, or counted over a longer window, and its real size is Not publicly specified.
The engine pauses its poller on 403, 418 and 429, `server/src/shared/errors.ts` line 1, so a mistyped path here would pause the poller rather than fail loudly.
Whether code 2136 arrives with 429 or with 200 decides whether the poller pauses at all, and that is not verified.

## 7. Server time and clock offset

`GET /fapi/v1/time` returns `{"serverTime":1790138901807}` in integer ms, and `/sapi/v1/time` the same shape for spot.
The server clock read 3.5 ms ahead of the local midpoint in the median of 10 calls in each of two runs, with a minimum of 2 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
No poller is recommended, since WazirX's index, mark and book are Binance's, see [`websocket.md`](./websocket.md) section 8.
If one is built anyway, this is its shape.

| item | recommendation | reason |
|---|---|---|
| source | `!markPrice@arr` on the socket, one frame a second with all 450 rows | no REST limit applies, and REST refused this host at an average of 16 `premiumIndex` calls a minute |
| REST fallback | `GET https://api.wazirx.com/fapi/v1/premiumIndex` no faster than every 10 s | the real limit is unknown, and 10 s is already the reader's age limit, `ANCHOR_MAX_AGE_MS` at `server/src/engine/opportunity/anchorReading.ts` line 5, so REST alone cannot keep a reading fresh |
| row mapping | section 3, key `symbol`, and the socket's lowercase `s` upper-cased | |
| interval | Binance's `fundingIntervalHours` for the mapped Binance symbol | WazirX publishes none, and `nextFundingTime` follows Binance's |
| rate limit | treat a body with `"code":2136` as a rate limit whatever the status, and pause 60 s, `rateLimitPauseMs` 60,000 | the refusal cleared within about 60 s, and whether it carries `Retry-After` is not verified |
| skip | INR contracts, unless INR joins a quote family | they are the USDT contracts times a fixed multiplier |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WazirX API documentation, sections "Futures Endpoints", "General API Information" and "Limits" | https://docs.wazirx.com/ | 2026-09-23 | Zanmai Labs Private Limited, India | calls, fields, limits, status codes, sections 1 to 7 |
| S2 | Introducing Crypto-USDT Futures on WazirX, published 2026-08-11 | https://wazirx.com/blog/introducing-crypto-usdt-futures-on-wazirx/ | 2026-09-23 | Zanmai, India | fixed USDT-INR rate for INR margin, section 2 |
| S3 | Binance USD-M public REST, `exchangeInfo`, `premiumIndex`, `ticker/24hr`, `fundingInfo`, `fundingRate` and `depth` | https://fapi.binance.com/fapi/v1/premiumIndex | 2026-09-23 | Binance | the comparison side of every check in sections 2 to 5 |
| P1 | `rest-probe.mjs latency` and `catalog`, runs at 04:35, 04:47, 04:56, 04:58 and 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1, 2, 7 |
| P2 | `rest-probe.mjs anchor`, runs at 04:35 and 04:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 3 and 4 |
| P3 | `rest-probe.mjs book` and `errors`, runs at 04:37, 04:48, 04:55 and 04:58 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 5 and 6 |
| P4 | `rest-probe.mjs funding`, runs at 04:48 and 04:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | section 4 |
| P5 | curl of `premiumIndex` single symbol calls at 04:59:35 and 05:00:36 UTC, of the spot `usdtinr` ticker at 04:59 UTC, and of the WazirX and Binance bulk tickers at about 05:01 UTC | none, one-off | 2026-09-23 | this host, Canadian VPN exit | sections 2 and 6, the INR multipliers and the code 2136 refusal |
