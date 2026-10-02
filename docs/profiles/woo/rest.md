# WOO X REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:05 to 04:37 UTC on 2026-09-23, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST v3 of WOO X (CCXT id `woo`) for its one perpetual family, the USDT-margined linear perpetuals.
Every measurement below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs), run twice, and the two readings are written side by side where they differ.
The index and mark rules come from the help center, read as described in [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| host | resolved to on 2026-09-23 | role |
|---|---|---|
| `api.woox.io` | 34.8.79.197, and every reply carried `via: 1.1 google` | public and private REST v3, S1 |
| `api-pub.woox.io` | 34.160.71.168 | CCXT's `pub` host for history calls, at `server/node_modules/ccxt/js/src/woo.js` line 139 |
| `wss.woox.io` | 34.49.135.176 | WebSocket, see [`websocket.md`](./websocket.md) |

| call | first request | three warm requests, first run | three warm requests, rerun |
|---|---|---|---|
| `GET /v3/public/systemInfo` | 207 and 197 ms | 126, 264, 120 ms | 120, 124, 119 ms |
| `GET /v3/public/instruments` | 122 and 137 ms | 123, 136, 120 ms | 122, 142, 121 ms |
| `GET /v3/public/futures` | 124 and 132 ms | 124, 121, 124 ms | 129, 127, 128 ms |
| `GET /v3/public/fundingRate` | 124 and 129 ms | 121, 121, 119 ms | 119, 123, 124 ms |

Access from this host, which exits in Canada, a country WOO X does not serve:

- Every public v3 call answered 200 with data, and so did the legacy `GET /v1/public/futures`.
- No reply carried a geoblock, a Cloudflare challenge or a region header.
- The help center HTML at `support.woox.io` answered 403 with a Cloudflare challenge, which is the only refusal met, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /v3/public/instruments` returns spot and perpetual rows in one reply, 150,286 characters uncompressed and 6,482 bytes gzipped, S2.

| field | perpetual values on 2026-09-23 |
|---|---|
| `symbol` | `PERP_<BASE>_USDT` |
| `status` | documented `TRADING`, `SUSPENDED` or `TESTING`, and all 223 perpetuals were `TRADING` in both runs |
| `baseAssetMultiplier` | 1 on all 223 |
| `fundingIntervalHours` | 4 on 149, 8 on 74 |
| `fundingCap`, `fundingFloor` | see [`fees.md`](./fees.md) section 6 |
| `impactNotional` | 100 to 10,000 USDT, see [`fees.md`](./fees.md) section 6 |
| `orderMode` | `NORMAL` on all 223 |
| `isAllowedRpi` | `true` on all 223 |

| family | active count | runs |
|---|---:|---|
| USDT-M linear perpetuals, `PERP_*_USDT` | 223 | both |
| spot USDT, `SPOT_*_USDT` | 88 | both |
| spot USDC | 2 | both |

CoinGecko listed 224 perpetual pairs the same day, see [`fees.md`](./fees.md) section 1.

### How CCXT 4.5.68 maps it

| item | CCXT | source line in `server/node_modules/ccxt/js/src/woo.js` | probed |
|---|---|---|---|
| catalog call | `fetchMarkets` calls `v3PublicGetInstruments` | 718 to 758, the call at 722 | 223 swaps, 223 active, in 495 and 508 ms |
| swap detection | a `PERP` prefix sets `swap` | 770 | |
| `market.id` | the raw `symbol` | 797 | `PERP_BTC_USDT`, identical to the socket topic symbol and to the `symbol` of `/v3/public/futures` and `/v3/public/fundingRate` on 223 of 223 |
| `contractSize` | the constant 1 | 791 | 1 on 223 of 223, which matches the base coin sizes on the book, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | the constant `true` | 792 | 223 of 223 |
| `active` | `status === 'TRADING'` | 795 | 223 of 223 |
| `settle` | the third part of the id | 788 and 789 | `USDT` on 223 of 223 |

The engine keeps active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196, so all 223 would load.

### Pairs listed twice, price scale and tickers that mean something else

No base and quote pair is listed twice, so no `marketFilter` is needed.
No contract is quoted per 10 or per 1000 units, since `baseAssetMultiplier` is 1 everywhere and no base carries a `1000` prefix.
Sub-cent tokens trade at their unit price, for example `PERP_DOGS_USDT` at an index of 0.00005112 and `PERP_HMSTR_USDT` at 0.000185, so a pair that another venue quotes per 1000 needs the cluster price scale of [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).
The three bases that start with a digit, `1INCH`, `2Z` and `0G`, map unchanged.

`PERP_EWT_USDT` had an index of 114.44 to 114.8 in both runs, while the Energy Web Token that other venues list as EWT trades near one dollar, so it is some other asset and needs a `DENIED_PAIRS` line before any venue lists EWT beside it.
The help center's index component table, last updated 2025-03-04, has no row for `EWT`, `SNDK`, `GRAM` or `SOLV`, S5.
`PERP_SNDK_USDT` had an index of 1883.81, which reads as an equity price.

Two perpetuals were `TRADING` with a broken anchor:

- `PERP_SOLV_USDT` had `"indexPrice":null` at 04:05 UTC and on the first poll of both runs, with a mark of 0.00418 and no 24 h volume.
- `PERP_EWT_USDT` had `nextFundingTime` 1790064000000, 2026-09-22 08:00 UTC, in the past, and an `estFundingRateTimestamp` frozen at 2026-09-22 02:17:59 UTC, while its index and mark kept moving.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time over 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /v3/public/futures` | `indexPrice` | `markPrice` | `estFundingRate`, and `lastFundingRate` | absent | `nextFundingTime`, Unix ms | 223 rows, 65,827 to 65,897 characters, 10,082 bytes gzipped | min 120 and 118, median 126 and 126, p90 130 and 129, max 216 and 208 ms |
| `GET /v3/public/fundingRate` | absent | absent | `estFundingRate`, and `lastFundingRate` | `estFundingIntervalHours`, hours | `nextFundingTime`, Unix ms | 223 rows, 56,532 to 56,538 characters, 2,327 bytes gzipped | min 120 and 117, median 137 and 121, p90 141 and 126, max 185 and 182 ms |
| `GET /v3/public/instruments` | absent | absent | absent | `fundingIntervalHours` | absent | 313 rows | as in section 1 |

No single call carries every `AnchorRow` column, so a poller needs `futures` and one of the two others.
`fundingRate` is the better second call, because its `estFundingIntervalHours` names the interval of the upcoming settlement, while `instruments` holds the configured one.
They agreed on 223 of 223 rows in both runs, and so did `lastFundingIntervalHours`, so the difference only shows during an interval change.
`estFundingRate`, `lastFundingRate` and `nextFundingTime` were equal between the two calls on 223 of 223 rows of one poll.
The replies are keyed by `symbol`, which is CCXT's `market.id`.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `PERP_BTC_USDT` | none |
| `index` | `futures.indexPrice` | decimal string, `null` on `PERP_SOLV_USDT` | `Number()`, and skip the row when `null` |
| `mark` | `futures.markPrice` | decimal string, never 0 or `null` on 223 rows | `Number()` |
| `fundingRate` | `futures.estFundingRate` | decimal string, a fraction per interval: `"0.00003676"` is 0.003676 % for the next 8 h | `Number()` |
| `fundingIntervalHours` | `fundingRate.estFundingIntervalHours` | integer hours, 4 or 8 | none |
| `nextFundingAt` | `futures.nextFundingTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none, and skip the row when it is in the past |

At 04:15 and 04:33 UTC every row except `PERP_EWT_USDT` read `1790150400000`, because 08:00 UTC is a settlement for both the 4 h and the 8 h symbols.

## 4. Anchor semantics

### Index

"Index Price: Average market price from major exchanges (This data is fetched once per second)", S5.
Each constituent is `market_price = median（bid1, ask1, last_price）` on that exchange's USDT spot pair, S5.
A constituent with no update "for a certain period" drops out, two valid exchanges give a volume-weighted average, one or fewer publishes no index, and none suspends the pair, S5.
The rule for three or more valid exchanges is Not publicly specified in the article.

| basket fact | value | source |
|---|---|---|
| exchanges | Binance, OKX, WOO X, Gate, Bybit, KuCoin, and Pyth for one row, `USD` | S5 table, 227 rows |
| sources per symbol | 6 on 63 symbols, 5 on 47, 4 on 53, 3 on 41, 2 on 18, 1 on 5 | S5 table |
| BTC, ETH, SOL, WOO | all six exchanges | S5 table |
| TAO | Gate and KuCoin only | S5 table |
| own venue | WOO X's own spot pair is a constituent on 118 of 227 rows, and its perpetual on none | S5 table |
| basket call | none public. The web app's `GET /md/v4/public/index_sources/<symbol>` and `/md/v4/public/index/items/<symbol>` answered 200 with no data for `SPOT_BTC_USDT`, `PERP_BTC_USDT`, `BTC_USDT` and `BTC` | probed with curl at 04:08 UTC |

The index is keyed by the spot symbol on the socket, `indexprice@SPOT_BTC_USDT`, see [`websocket.md`](./websocket.md) section 2.
In March 2023 WOO X added Gate, Bybit and KuCoin as sources and removed Huobi, S6.

### Mark

From S5:

```text
Mark Price = Median of (P1, P2, P3)
P1 = Index_price * (1 + Last Funding Rate * (Time Until Funding (in hours) / Current Funding Interval))
P2 = Index_price + MA(5 minute basis), basis = median(bid1, ask1) - Index_price every 5 seconds, P2 floored at 0
P3 = median(bid1, ask1, last_price) on WOO X, null when the book is stale
```

Every clamp and override the article lists:

- When the index and the last price differ by more than 1 % for more than 30 minutes, mark = P2.
- A last funding rate collected more than one interval plus one hour ago counts as 0 in P1.
- During maintenance or with no best bid and ask, mark = index.
- "if bid liquidity < impact notional or ask liquidity < impact notional, mark price = Index_price".
- With no index, mark = P3.

The liquidity rule decides this venue's reading.
On every poll between 53 and 90 of 223 perpetuals had a mark exactly equal to the index, and 71 and 66 of 222 had a zero premium on the first poll of each run.
A mark pinned to the index carries no premium, so the engine's fresh gate would read that leg as fresh whatever its book says, which is the capped mark failure of the design's section 4.
Which book the liquidity rule measures, with or without RPI orders, is Not publicly specified.

The largest premiums on the first poll were `PERP_ONE_USDT` at -7,230 and -8,360 ppm, `PERP_STBL_USDT` at 5,032 and 5,020 ppm, and `PERP_MELANIA_USDT` at 8,772 ppm in the rerun.

### Funding

The formula, interval, caps and the baseline the published rates sit on are in [`fees.md`](./fees.md) section 6.
`estFundingRate` is the upcoming rate, re-estimated once a minute.
`estFundingRateTimestamp` changed once in 59 one second polls on every watched symbol except the frozen `PERP_EWT_USDT`, and the socket's `estfundingrate` pushed 60.0 s apart.
`lastFundingRate` is the last settled rate, and it equalled the newest `fundingRateHistory` row, for example BTC `0.00001021` settled at 2026-09-23 00:00 UTC.

### Rate across a settlement

The settlement instant itself was not captured, since the probes ran between 04:05 and 04:37 UTC.
`GET /v3/public/fundingRateHistory?symbol=<id>` returns settled rows with `fundingRateTimestamp`, `nextFundingTime` and `markPrice`, and 13,027 rows exist for BTC.

| symbol | settlements in the newest six rows | rates |
|---|---|---|
| `PERP_BTC_USDT` | 2026-09-21 08:00 to 2026-09-23 00:00 UTC, every 8 h at 00:00, 08:00 and 16:00 | `0.0001`, `0.00005597`, `0.00007603`, `0.0001`, `0.00002874`, `0.00001021` |
| `PERP_TAO_USDT` | 2026-09-22 08:00 to 2026-09-23 04:00 UTC, every 4 h | `0.00008882`, `0.00007134`, `0.00005`, `0.00005`, `0.00008959`, `0.00005` |

Each row's `nextFundingTime` is the next row's settlement, so the interval in force is readable from history.

### How often each number changed

Over 59 intervals of one second polls, first run and rerun:

| symbol | `indexPrice` | `markPrice` | `estFundingRate` | `nextFundingTime` | interval |
|---|---|---|---|---|---|
| `PERP_BTC_USDT` | 20 and 30 | 23 and 32 | 1 and 1 | 0 | 0 |
| `PERP_ETH_USDT` | 23 and 22 | 29 and 22 | 0 and 0 | 0 | 0 |
| `PERP_TAO_USDT` | 13 and 7 | 15 and 11 | 0 and 0 | 0 | 0 |
| `PERP_WOO_USDT` | 2 and 1 | 4 and 4 | 0 and 0 | 0 | 0 |
| `PERP_EWT_USDT` | 24 and 21 | 9 and 10 | 0 and 0 | 0, frozen in the past | 0 |

Prices are rounded to the symbol's tick, `quoteTick` 1 on BTC, so a BTC index change smaller than one dollar, about 11.5 ppm, does not show.
Every reply arrived 60 to 82 ms after its own `timestamp`, with a clock offset under 50 ms, see section 7.

## 5. REST book snapshot

`GET /v3/public/orderbook?symbol=<id>&maxLevel=<n>&rpi=<bool>`, documented default `maxLevel` 100 and `rpi` false, S2.
Levels arrive as `{"price": "86944", "quantity": "0.0002"}` objects, bids descending and asks ascending on every read, although S2 says "Price of asks/bids are in descending order".
The reply's `timestamp` is the book's last change, not the server clock: the non-RPI BTC book showed 3 distinct values over 20 one second reads in both runs, the oldest 24 s and 53 s old, while the RPI book showed 20 of 20.
No reply carried a cache header.

| symbol | run | non-RPI levels | non-RPI spread | RPI spread | non-RPI book age |
|---|---|---|---|---|---|
| `PERP_BTC_USDT` | 1 and 2 | 65 and 66 bids, 70 and 63 asks | 4,299 and 3,652 ppm | 12 and 11 ppm | 7.7 and 22.1 s |
| `PERP_ETH_USDT` | 1 and 2 | 39 bids, 13 and 12 asks | 6,046 and 6,140 ppm | 36 and 36 ppm | 14.2 and 6.7 s |
| `PERP_SOL_USDT` | 1 and 2 | 38 bids, 10 asks | 21,435 and 22,267 ppm | 84 and 84 ppm | 1.4 and 2.6 s |
| `PERP_TAO_USDT` | 1 and 2 | 9 bids, 3 asks | 203,177 ppm, bid 271.5 and ask 332.9 in both | 1,592 and 1,902 ppm | 4.8 h and 16.4 min |

The non-RPI book is what an API taker fills against, see [`fees.md`](./fees.md) section 5.
Its best BTC ask in both runs was a single `0.0002` BTC order, and its top 20 bid levels held about 454,000 USDT against 9.3 to 13.5 million with RPI.
`maxLevel` 1 and 20 cut the ETH book to 1 and 20 bids, and 50, 100, 200, 500, 1000 or no `maxLevel` all returned the whole non-RPI book of 39 bids and 12 or 13 asks.
The BTC REST book lagged the socket by up to 46.6 s, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| public v3 limit | "10 requests per 1 second per IP address" on each of `instruments`, `futures`, `fundingRate` and `orderbook` | S2, S3 |
| CCXT cost | 1 per public v3 call, with the comment `// 10/1s` | `server/node_modules/ccxt/js/src/woo.js` lines 244 to 257 |
| status on a limit | HTTP 429 with `-1003 TOO_MANY_REQUEST`, from the legacy documentation | S4 |
| `Retry-After` | Not publicly specified, and not observed since the probes stayed under the limit | |
| rate headers | none: a reply carried `alt-svc`, `content-encoding`, `content-type`, `date`, `transfer-encoding`, `via`, `x-request-id` and `x-trace-id` only | P3 |

| request | status | body |
|---|---|---|
| `orderbook?symbol=PERP_NOPE_USDT` | 400 | `{"success":false,"message":"invalid symbol PERP_NOPE_USDT"}` |
| `orderbook` without `symbol` | 400 | `{"success":false,"code":-1005,"error_code":90000,"message":"invalid request, please check your request"}` |
| `orderbook?symbol=PERP_BTC_USDT&maxLevel=abc` | 500 | `{"success":false,"code":-1000,"message":"The server encountered an internal error, request id: …"}` |
| `futures?symbol=PERP_NOPE_USDT` | 500 | `{"success":false,"message":"invalid symbol PERP_NOPE_USDT"}` |
| `fundingRate?symbol=PERP_NOPE_USDT` and `SPOT_BTC_USDT` | 500 | `{"success":false,"message":"no funding rate data for …"}` |
| `/v3/public/nope` | 200 | `{"code":503,"message":"[GW] no upstream server"}` |

The engine pauses only on 403, 418 and 429, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1, so a poller must check `success` itself, since a gateway failure can arrive as HTTP 200.

## 7. Server time and clock offset

`GET /v3/public/systemInfo` answers `{"success":true,"data":{"status":0,"msg":"System is functioning properly.","estimatedEndTime":…},"timestamp":…}`, where `status` 1 means trading maintenance and 2 means system maintenance, S2.
Ten reads per run put the server clock 0 to 43 ms and 1 to 39 ms ahead of the local clock at the request midpoint, median 2 and 3 ms, with round trips of median 123 and 121 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://api.woox.io/v3/public/futures` and `https://api.woox.io/v3/public/fundingRate`, fetched in parallel each round | one call lacks the interval, section 3 |
| interval | 1 s, the poller default at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 7 | 2 requests a second against 10 per endpoint, and replies took 117 to 216 ms |
| row mapping | section 3, joined on `symbol` | |
| skip | a row with `indexPrice` `null`, a row whose `nextFundingTime` is in the past, and a symbol missing from either reply | `PERP_SOLV_USDT` and `PERP_EWT_USDT`, section 2 |
| `rateLimitPauseMs` | 1,000 | the limit window is one second and no `Retry-After` is documented, where the default is 60,000 at line 9 |
| mark equal to index | log the count each summary, and treat such a leg as unjudged | 53 to 90 rows per poll, section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Integration guide and Introduction | https://developer.woox.io/api-reference/guide and https://developer.woox.io/api-reference/introduction | 2026-09-22 | WOO X, global | base URL, response shape, strings for decimals, section 1 |
| S2 | Get instruments, Get futures info, Orderbook snapshot, Get system maintenance status | https://developer.woox.io/api-reference/endpoint/public_data/instruments and the `futures`, `orderbook` and `systemInfo` pages beside it | 2026-09-22 | WOO X, global | fields, status enum, limits, book parameters, sections 2, 5, 6, 7 |
| S3 | Get predicted funding rate, Get funding rate history | https://developer.woox.io/api-reference/endpoint/public_data/fundingRate and `fundingRateHistory` | 2026-09-22 | WOO X, global | fields and limits, sections 3 and 4 |
| S4 | Legacy API documentation, rate limit and error codes | https://docs.woox.io/ | 2026-09-22 | WOO X, global | 429 and `-1003`, section 6 |
| S5 | ▶ Indices, updated 2025-03-04 | https://support.woox.io/hc/en-us/articles/4718431277465--Indices, read as its Help Center API JSON | 2026-09-22 | WOO X, global | index, mark and basket, sections 2 and 4 |
| S6 | Index price adjustment for perpetual swaps | https://support.woox.io/hc/en-us/articles/16736807382041 | 2026-09-22 | WOO X, global | 2023 source change, section 4 |
| S7 | CCXT 4.5.68 `woo.js` | `server/node_modules/ccxt/js/src/woo.js` | 2026-09-22 | CCXT | market mapping and costs, sections 2 and 6 |
| P1 | `rest-probe.mjs catalog`, runs at 04:15 and 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 2 |
| P2 | `rest-probe.mjs anchor`, runs at 04:15 and 04:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 4 |
| P3 | `rest-probe.mjs errors`, `time` and `history`, runs at 04:27 and 04:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 4, 6, 7 |
| P4 | `rest-probe.mjs book`, runs at 04:16 and 04:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/woo/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P5 | curl reads of the catalog, the anchor calls, the index basket calls and the gzip sizes, 04:05 to 04:38 UTC | not scripted | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 5 |
