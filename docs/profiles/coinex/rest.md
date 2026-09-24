# CoinEx REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:34 UTC, each probe mode run twice, from the development host near Seattle.

This profile covers the public REST API v2 of CoinEx (CCXT id `coinex`) for its perpetual futures.
CoinEx futures ceased on 2026-09-22 under the cessation notice recorded in [`fees.md`](./fees.md) section 1.
The API still answers, lists 221 contracts as `online`, and serves an index, mark and funding rate frozen since 03:10 UTC on 2026-09-22.
Every probed value comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coinex/rest-probe.mjs) unless a curl is named.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.coinex.com`, a CNAME of `d1pp1742gn4fe8.cloudfront.net`, four addresses in 18.172.170.0/24 on 2026-09-23 |
| edge | CloudFront POP `SEA73-P3`, `x-cache: Miss from cloudfront` |
| cold request | `GET /v2/time` in 167 and 184 ms, two `catalog` runs |
| warm request | `GET /v2/time` in 99 to 107 ms over eight requests, and `GET /v2/ping` in 103 and 104 ms |
| refusals | none. Every public call answered HTTP 200 |

## 2. Catalog

### The instruments call

`GET https://api.coinex.com/v2/futures/market` returned 221 contracts in 87,429 bytes in 126 and 134 ms, with no pagination.

| family | `contract_type` | `quote_ccy` | count | `status` |
|---|---|---|---:|---|
| USDT-margined | `linear` | `USDT` | 201 | `online` |
| USDC-margined | `linear` | `USDC` | 18 | `online` |
| coin-margined | `inverse` | `USD` | 2, `BTCUSD` and `ETHUSD` | `online` |

Every contract still read `status` `online` and `is_api_trading_available` true, while `is_market_available` was false on all 221.
`delisted_at` was 0 on 220 contracts and 1789441200000, 2026-09-15 03:00 UTC, on `LRCUSDT`.
`open_interest_volume` was `"0"` on all 221, while `futures/ticker` gave `BTCUSDT` an `open_interest_volume` of `"552.725"`.
So the catalog flags do not say that trading stopped, and a reader has to look at the books.

### Evidence that futures stopped

| check | reading |
|---|---|
| books | 28 of 28 sampled REST books, every eighth contract, had no bid and no ask, `depth` mode. All 221 books were empty on the socket, [`websocket.md`](./websocket.md) section 4 |
| trades | the last `BTCUSDT` trades printed at 03:17:52.900 UTC on 2026-09-22 at 85,618, `depth` mode |
| volume | `volume` `"0"` on 221 of 221 tickers. Hourly `BTCUSDT` klines show 221.0908 BTC in the 03:00 UTC hour of 2026-09-22 and 0 in each of the 24 hourly klines after it, the last one still open, curl of `futures/kline` |
| index | every `futures/index` row was created between 03:09 and 03:10 UTC on 2026-09-22 |
| funding | `next_funding_time` read 2026-09-22 16:00 UTC on 221 of 221 contracts, more than 11 hours in the past |
| against Binance | the CoinEx index differed from the Binance USDⓈ-M index by a median of 39,943 and 40,540 ppm over 191 shared symbols in two runs, and by more than 1,000 ppm on 186 and 190 of them, `anchor` mode |

The `BTCUSDT` futures klines also show the reduce-only week thinning the book.
Hourly lows reached 77,858, 74,050 and 62,900 in the 20:00, 21:00 and 22:00 UTC hours of 2026-09-21, while the Binance hourly closes were 86,961, 86,544 and 86,419, curl of both `kline` calls.

### How CCXT 4.5.68 maps it

| item | CCXT | against the wire |
|---|---|---|
| source call | `fetchContractMarkets` calls `v2PublicGetFuturesMarket` at `coinex.js` lines 911 and 912 | same call |
| swaps after the connector filter | 221 | 221 |
| `market.id` | the REST `market`, `BTCUSDT` | equal on 221 of 221, and equal to the socket's `data.market` |
| `active` | `undefined` on every swap, line 967 | passes `market.active !== false` in [`connector.ts`](../../../server/src/ccxt/connector.ts), so CCXT would still hand the engine 221 dead contracts |
| `settle` | `USDT` for every linear contract, line 948 | wrong for the 18 USDC-margined contracts, which CCXT names `BTC/USDC:USDT` |
| `linear` | true on 219, false on the 2 inverse | matches `contract_type` |
| `contractSize` | 1 on every swap, line 973 | not verifiable on an empty book |
| `taker` | 0.001, line 971 from line 448 | the catalog says 0.0005, see [`fees.md`](./fees.md) section 8 |
| pairs listed twice | none | 18 bases trade against both USDT and USDC, such as BTC, ETH and SOL, and the quote family would pick one |

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /v2/futures/ticker` | `index_price` | `mark_price` | absent | absent | absent | 54,750 bytes, 221 rows | 20 polls, two runs: min 112 and 114, median 121 and 122, max 297 and 447 ms |
| `GET /v2/futures/funding-rate` | absent | `mark_price` | `latest_funding_rate`, `next_funding_rate` | `next_funding_time` minus `latest_funding_time` | `next_funding_time`, Unix ms | 52,526 bytes, 221 rows | 20 polls, two runs: min 110 and 113, median 118 and 122, max 291 and 318 ms |
| `GET /v2/futures/index` | `price` with its `sources` basket | absent | absent | absent | absent | 77,349 bytes, 221 rows | 156 ms, one curl |

Two calls would have been needed for a full `AnchorRow`, the ticker for the index and the funding call for rate and timing.
Both answered for all 221 contracts without a `market` parameter.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| key | `market` | equals CCXT `market.id` |
| `index` | ticker `index_price` | frozen at 03:10 UTC on 2026-09-22 |
| `mark` | ticker `mark_price` | frozen, `BTCUSDT` read 83,154 against an index of 85,618.24, a gap of -28,782 ppm |
| `fundingRate` | funding `latest_funding_rate` | documented as the rate for the current settlement, recomputed every minute, S2 |
| `fundingIntervalHours` | `(next_funding_time - latest_funding_time) / 3,600,000` | 8 on all 221 |
| `nextFundingAt` | `next_funding_time` | 2026-09-22 16:00 UTC on all 221, in the past |

## 4. Anchor semantics

### Index

`futures/index` publishes each basket.
`BTCUSDT` weighted Binance 0.5, OKX 0.2, KuCoin 0.15 and Bybit 0.15, `catalog` mode.
The baskets of the other contracts were not surveyed, because nothing trades against them.

### Mark

The mark formula and its clamps were not researched.
The frozen `BTCUSDT` mark sat 28,782 ppm below the frozen index, a gap no running perpetual would publish.

### Funding

Funding was paid every 8 hours by default, and a positive rate had longs pay shorts, S2.
The caps were ±0.015 on 158 contracts, ±0.0075 on 59 and ±0.00375 on 4, `catalog` mode.
The `BTCUSDT` funding history, `depth` mode, shows the reduce-only week pinned to the short side.

| settlement, UTC | actual rate |
|---|---|
| 2026-09-20 16:00 | -0.00374996 |
| 2026-09-21 00:00 | -0.00348955 |
| 2026-09-21 08:00 | -0.00352562 |
| 2026-09-21 16:00 | -0.00374995 |
| 2026-09-22 00:00 | -0.00374992 |
| 2026-09-22 08:00 | 0 |
| 2026-09-22 16:00 | -0.00375 |
| 2026-09-23 00:00 | -0.00375 |

The last two rows were written after trading stopped at 03:17 UTC on 2026-09-22, while `futures/funding-rate` still named 16:00 as the next settlement.
No settlement instant was captured.

### How often each number changed

Over 20 polls one second apart, twice, the `BTCUSDT` mark, index and next settlement each held one value.

## 5. REST book snapshot

`GET /v2/futures/depth?market=BTCUSDT&limit=50&interval=0` answered with `"asks":[]`, `"bids":[]` and `"checksum":0` on every sampled contract in both runs, the slowest in 274 and 207 ms.
The spot book at `GET /v2/spot/depth?market=BTCUSDT&limit=50&interval=0` held 50 bids and 50 asks at the same time.

## 6. Rate limits and errors

The IP limit is "relatively high, and users generally will not trigger such limits", with no number published, S3.
The documented rate limit errors are code 3008 "Service busy", 4001 "Service unavailable" and 4213 "Rate limit triggered", S3.
No limit was reached at five requests a second, so the limit reply and any `Retry-After` header were not observed.
An unknown market answers HTTP 200 with `{"code":4004,"data":{},"message":"invalid argument"}`.

## 7. Server time and clock offset

`GET /v2/time` returns `{"code":0,"data":{"timestamp":1790133532655},"message":"OK"}` in Unix ms.
The offset against this host's clock at the midpoint of each request was 0 to 5 ms over eight warm requests and 31 ms on each cold one.

## 8. Recommended poller shape

None.
CoinEx futures ceased on 2026-09-22, and the anchor endpoints now serve values frozen that morning, so no poller should be written.
A poller that read them would have seen a stale index and a `nextFundingAt` in the past on every row.
The age check would not have caught it, because a row without its own `ts` is stamped on arrival at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 133, and only the `created_at` of `futures/index` shows the index's age.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Important Notice on CoinEx's Orderly Cessation of Operations | https://coinex-announcement.zendesk.com/hc/en-us/articles/53539656293908 | 2026-09-22 | CoinEx, global | futures ceased 2026-09-22, introduction |
| S2 | Get Market Funding Rate, CoinEx API v2 | https://docs.coinex.com/api/v2/futures/market/http/list-market-funding-rate | 2026-09-22 | CoinEx, global | field meanings, 8 h default, sign, sections 3 and 4 |
| S3 | Rate Limit, CoinEx API v2 | https://docs.coinex.com/api/v2/rate-limit | 2026-09-22 | CoinEx, global | IP limit wording, error codes, section 6 |
| S4 | CCXT 4.5.68 `coinex.js` | `server/node_modules/ccxt/js/src/coinex.js` | 2026-09-22 | CCXT | lines 448, 911, 912, 948, 967, 971 and 973, section 2 |
| P1 | `rest-probe.mjs catalog`, `anchor` and `depth` | [`rest-probe.mjs`](../../../scripts/probes/venues/coinex/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | curl of `futures/kline` on CoinEx and `fapi/v1/klines` on Binance for `BTCUSDT`, 1 h | https://api.coinex.com/v2/futures/kline?market=BTCUSDT&period=1hour&limit=60 | 2026-09-22 | this host | the reduce-only week and the last traded hour, section 2 |
