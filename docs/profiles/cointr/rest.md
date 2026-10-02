# CoinTR REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:15 to 03:41 UTC, from the development host near Seattle.

This profile covers CoinTR's public REST API v2 at `https://api.cointr.com`.
CoinTR serves no perpetual, so it covers the spot catalog and book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says, and it records the documented futures calls only to show that they are not served.
Every number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) unless a source id says otherwise.
The API reproduces Bitget's V2 API: the same paths, the same `productType` values, the same error codes and the same field names, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| REST host | `https://api.cointr.com`, "Main Domain" | S1 |
| resolved address | `api.cointr.com` is a CNAME to `api.cointr.com.cloudscdn.net`, which resolved to 104.18.20.225 and 104.18.21.225, Cloudflare | `dig`, P3 |
| edge | every reply carried `server: cloudflare` and `cf-cache-status: DYNAMIC`, and the `cf-ray` ended in `YVR`, the Vancouver edge, in the first run and `SEA`, Seattle, in the rerun | P12 |
| DNS lookup | 16 and 12 ms | P3 |
| `GET /api/v2/public/time` | cold 303 and 282 ms. Warm over 20 requests, first run and rerun: min 194 and 194, median 200 and 198, p90 203 and 204, max 753 and 213 ms | P3 |
| `GET /api/v2/spot/market/tickers`, 85 KB | cold 211 and 208 ms. Warm min 209 and 212, median 216 and 217, p90 224 and 224, max 398 and 399 ms | P3 |
| `GET /api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=150` | cold 199 and 196 ms. Warm min 194 and 196, median 198 and 199, p90 201 and 205, max 203 and 213 ms | P3 |
| compression | Brotli by default (`content-encoding: br`), gzip when asked | P12 |
| legacy CoinTR Pro host | `https://api.cointr.pro` resolves to 104.18.16.222 and 104.18.17.222 and answers HTTP 404 from openresty on `/`, `/v1/spot/public/time`, `/v1/spot/public/instruments`, `/v1/futures/public/instruments` and `/v1/futures/market/tickers`. Its documentation at https://cointr-ex.github.io/openapis/ is still online | P2, S6 |

The round trip of about 200 ms from Seattle is the floor for every call, from either edge, so CoinTR's origin sits far behind Cloudflare.

## 2. Catalog

### The instruments call

`GET /api/v2/spot/public/symbols` returns every spot pair in one reply of 87,767 bytes, with no paging (S2, P1).

| field | meaning | observed |
|---|---|---|
| `symbol` | pair id | `BTCUSDT`, equal to `baseCoin` plus `quoteCoin` on all 263 rows |
| `baseCoin`, `quoteCoin` | assets | quotes: 134 `USDT`, 128 `TRY`, 1 `SUSDT` |
| `status` | `online`, `gray`, `halt` or `offline` (S2) | 261 `online`, 2 `gray` (`REEFTRY`, `RNDRTRY`) |
| `makerFeeRate`, `takerFeeRate` | fee fraction | `"0.001"` on every row, which disagrees with the published schedule, see [`fees.md`](./fees.md) section 2 |
| `pricePrecision`, `quantityPrecision`, `quotePrecision` | decimals | `BTCUSDT`: 2, 5, 6 |
| `minTradeUSDT` | minimum order value | `"1"` on `BTCUSDT` |
| `buyLimitPriceRatio`, `sellLimitPriceRatio` | price band | `"0.02"` on `BTCUSDT` |

No pair is listed twice.
`SBTCSUSDT` is the only `SUSDT` row, and its ticker had no bid or ask, which matches the `S` prefix the docs give the demo trading product types (S3).
`GET /api/v2/spot/public/coins` returned 418 coins, and the tickers call returned 262 rows in both runs (P1).

### Volume and spread

The tickers call, `GET /api/v2/spot/market/tickers`, returns every pair's best bid and ask with sizes, last price and 24 h volume in one reply of about 85 KB (P1).

| item | value |
|---|---|
| 24 h `usdtVolume`, USDT pairs | 115,275,180 and 113,213,152 in the two runs, of which `USDCUSDT` is 45,356,970 and 45,612,733 |
| 24 h `usdtVolume`, TRY pairs | 44,708,237 and 44,682,663 |
| busiest USDT pairs | `USDCUSDT`, `XRPUSDT` 6.0 M, `RECALLUSDT` 5.6 M, `LABUSDT` 5.1 M, `ASTERUSDT` 4.9 M, `BTCUSDT` 4.5 M, `ETHUSDT` 3.6 M |
| spread of the 20 busiest USDT pairs | 7 and 29 ppm on `ETHUSDT`, 291 and 304 ppm on `BTCUSDT`, and more than 10,000 ppm on four of the twenty in the first run and five in the rerun, up to 18,018 ppm |
| pairs with an empty or one-sided ticker | 2, `SBTCSUSDT` and `REEFTRY` |

### How the engine's catalog would map it

The engine's catalog is `loadMarkets` from CCXT filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 79 with the predicate at lines 199 and 200.
CoinTR has no CCXT class and no swap, so it contributes nothing, see [`fees.md`](./fees.md) section 8.
For the record, the spot fields would map without surprises.
`symbol` equals the socket's `instId`, sizes are in the base coin on both REST and the socket, so a contract size of 1 is right, and no pair needs a price scale.
TRY pairs sit outside the engine's quote family at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 4, 5 and 13, which leaves the 134 USDT pairs.

## 3. Anchor

CoinTR publishes no index price, no mark price and no funding rate.
The documented futures calls that would carry them all answer HTTP 400 `{"code":"40404","msg":"Request URL NOT FOUND","data":null}` (P2):

| documented call (S4) | reply |
|---|---|
| `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES`, also `usdt-futures`, `COIN-FUTURES`, `USDC-FUTURES`, `SUSDT-FUTURES` | 400, 40404 |
| `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` and the same four other values | 400, 40404 |
| `GET /api/v2/mix/market/ticker`, `current-fund-rate`, `history-fund-rate`, `funding-time`, `symbol-price`, `merge-depth`, `open-interest`, `vip-fee-rate` | 400, 40404 |
| `GET /api/v2/mix/market/candles`, `history-index-candles`, `history-mark-candles` | 400, 40404 |
| `GET /api/mix/v1/market/contracts?productType=umcbl`, the Bitget V1 form | 404 from openresty |

The only reference prices published are the spot ticker's `lastPr`, `bidPr` and `askPr`.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since no index, mark or funding exists.

One observation matters to anyone reading CoinTR's tape as a price reference.
Trade prints fall inside the visible spread.
In three 60 s runs of the `sync` mode, 76 of 77, 69 of 69 and 63 of 63 `BTCUSDT` prints, and 54 of 67, 61 of 69 and 66 of 73 `ETHUSDT` prints, were strictly between the socket book's best bid and best ask at the moment they arrived (P9).
In the third run the prints were 0.0001 to 0.00066 BTC and 0.0019 to 0.022 ETH, see [`websocket.md`](./websocket.md) section 6 for one print beside the ticker.
Where that liquidity comes from is Not publicly specified.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET /api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=150` | S2 |
| depth | `limit` up to 150, default 150. `limit=200` returned 89 bids and 150 asks, then 91 and 150, so it is clamped | S2, P11 |
| merged book | `GET /api/v2/spot/market/merge-depth?symbol=…&precision=scale0&limit=max` adds `scale`, `precision` and `isMaxPrecision` | S2, P11 |
| reply | `{"asks": [[price, size], …], "bids": […], "ts": "<ms>"}`, strings | P11 |
| level order | bids descending and asks ascending, best first, with 0 out-of-order levels on `BTCUSDT`, `USDTTRY` and `EDUUSDT` | P11 |
| thin sides | `BTCUSDT` held 87 and then 91 bids, the last at a price of `0.1`, against 150 asks, and `EDUUSDT` held 50 bids and 53 asks | P11 |
| price text | REST drops trailing zeros, as in the book's best ask `"86714.4"` and the ticker's `"askPr":"2762"`, while the socket always writes the pair's two decimals, as in `"86618.70"` and `"190000.00"`, so the two compare equal only as numbers | P1, P11, P5 |
| size text | `USDTTRY` sizes arrive with 16 trailing zeros, as in `"79250.3000000000000000"` | P11 |
| freshness | `ts` was 98 to 104 ms older than arrival, half the round trip | P11 |
| caching | none seen: `ts` advanced on each of 10 reads 120 ms apart, with and without a cache-busting parameter, and `cf-cache-status` was `DYNAMIC` | P11 |
| against the socket | the REST top five equalled the socket book's top five, compared as numbers, on 59 and 59 of 60 `BTCUSDT` reads and 60 and 58 of 60 `ETHUSDT` reads in two runs | P9 |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| market data calls | 20 requests per second per IP, per endpoint | S2 |
| `vip-fee-rate` | 10 requests per second per IP | S2 |
| overall | "The overall rate limit is 6000/IP/Min", and each endpoint is counted on its own | S5 |
| limit headers | none: a normal reply carries no rate-limit header | P12 |
| status on a limit | Not verified, since the probe stayed well inside the limits and no refusal was seen | |
| `Retry-After` | Not observed | |

| request | status | body |
|---|---|---|
| unknown symbol on `orderbook` | 400 | `{"code":"40034","msg":"Parameter NOPEUSDT does not exist","requestTime":1790133421135,"data":null}` |
| unknown symbol on `tickers` or `symbols` | 400 | `{"code":"42016","msg":"symbol NOPEUSDT is Invalid or not supported spot trade",…}` |
| bad `type` | 400 | `{"code":"40020","msg":"Parameter type error",…}` |
| missing `symbol` | 400 | `{"code":"40019","msg":"Parameter symbol cannot be empty",…}` |
| unknown path under `/api/v2` | 400 | `{"code":"40404","msg":"Request URL NOT FOUND",…}` |
| unknown path outside `/api/v2` | 404 | openresty HTML page |
| `vip-fee-rate` | 500 | `{"code":"40725","msg":"service return an error","data":null}` |

Every JSON reply has the envelope `{code, msg, requestTime, data}`, and success is `"code":"00000"`.
The 40404 code arrives with HTTP 400, not 404, so a client that branches on the status alone reads a missing path as a bad parameter.

## 7. Server time and clock offset

`GET /api/v2/public/time` returns `{"code":"00000","msg":"success","requestTime":…,"data":{"serverTime":"…"}}`, and `requestTime` equalled `serverTime` on 10 of 10 reads (P3).
Against this host's clock the offset was between -1 and 4 ms over 10 reads, and 1 ms at the best round trip of 194 ms, then between 1 and 4 ms, and 2 ms at 192 ms, in the rerun (P3).

## 8. Recommended poller shape

None.
CoinTR publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read.
If a spot leg is ever modelled, the socket in [`websocket.md`](./websocket.md) section 8 carries the book, and the tickers call above is a 1 Hz fallback for the touch at 216 ms median, 20 per second allowed.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinTR API docs, API Domain | https://www.cointr.com/api-doc/common/domain | 2026-09-22 | CoinTR | REST and socket hosts, section 1 |
| S2 | CoinTR API docs, spot market: Get Symbol Info, Get Tickers, Get OrderBook, Get Merge Depth, VIP fee rate | https://www.cointr.com/api-doc/spot/market/get-symbols | 2026-09-22 | CoinTR | catalog fields and status values, book parameters, per endpoint limits, sections 2, 5 and 6 |
| S3 | CoinTR API docs, futures intro | https://www.cointr.com/api-doc/contract/intro | 2026-09-22 | CoinTR | product types and the `S` demo prefix, section 2 |
| S4 | CoinTR API docs, futures market pages | https://www.cointr.com/api-doc/contract/market/get-all-symbols-contracts | 2026-09-22 | CoinTR | documented futures paths, section 3 |
| S5 | CoinTR API docs, FAQ, Q7 | https://www.cointr.com/api-doc/common/faq | 2026-09-22 | CoinTR | overall rate limit, section 6 |
| S6 | CoinTR Pro API reference | https://cointr-ex.github.io/openapis/ | 2026-09-22 | CoinTR Pro | legacy hosts `api.cointr.pro` and `stream.cointr.pro`, section 1 |
| P1 | `rest-probe.mjs catalog` at 03:15 and 03:34 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | section 2 |
| P2 | `rest-probe.mjs futures` at 03:15 and 03:34 UTC, with one run between them for the legacy host | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 3 |
| P3 | `rest-probe.mjs latency` at 03:16 and 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 7 |
| P5 | `ws-probe.mjs book` at 03:19 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | socket price text, section 5 |
| P9 | `ws-probe.mjs sync`, runs at 03:21, 03:22 and 03:37 UTC, the first before the probe compared REST and socket prices as numbers | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | trade prints inside the spread, REST against socket, sections 4 and 5 |
| P11 | `rest-probe.mjs book` at 03:16 and 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | section 5 |
| P12 | `rest-probe.mjs errors` at 03:17 and 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cointr/rest-probe.mjs) | 2026-09-22 | this host | sections 1 and 6 |
