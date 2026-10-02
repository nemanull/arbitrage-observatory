# ZebPay REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:45 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare `loc=CA`, SEA edge).

This profile covers the public futures REST API v1 of ZebPay (CCXT id `zebpay`), which lists perpetuals only, in two quote families, USDT and INR.
The documentation is the public GitHub repository S1, read at commit `1be7da7` of 2026-09-19.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs), and the socket comparison from [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs).
Every number below was read against Binance USD-M's public API in the same second, and the answer is that ZebPay relays Binance: the book, the mark, the index, the interval and the next funding time are Binance's, and the funding rate is Binance's scaled by 0.9 to 1.1.
All probe times are UTC on 2026-09-23.

## 1. Host and latency from this machine

| host | role | resolved | evidence |
|---|---|---|---|
| `futuresbe.zebpay.com` | futures REST | Cloudflare, `104.18.30.215` and `104.18.31.215` plus two IPv6, `cf-ray` ending `-SEA` | P1 |
| `futuresws.zebpay.com` | public futures socket | four IPv4 addresses `18.238.238.9`, `.30`, `.41`, `.68` and eight IPv6 in `2600:9000::`, which are CloudFront ranges | P1 |
| `sapi.zebpay.com` | spot REST | CNAME `d-x4pho0owb3.execute-api.ap-southeast-1.amazonaws.com`, `18.136.12.86` and `18.140.133.212` | P1, `dig` |

| call | cold | warm |
|---|---|---|
| `GET /api/v1/system/time` | 889 and 831 ms, and 969 ms by curl at 04:12 | 196 to 228 ms over ten calls in two runs |
| `GET /api/v1/market/marketInfo`, 109 KB | | two runs of 60 polls: min 205 and 202, median 284 and 211, p90 315 and 302, max 374 and 1,345 ms |

Every call returned 200 through the Canadian VPN exit, and nothing refused this host.

## 2. Catalog

### The instruments call

`GET https://futuresbe.zebpay.com/api/v1/market/markets` returns every active perpetual, 165 KB, in the envelope `{statusDescription, data, statusCode, customMessage}`, P1.

| item | value |
|---|---|
| rows | 425, every one `"status": "Open"` |
| USDT quote | 248 |
| INR quote | 177 |
| bases listed in both | 170, and 7 INR only: `LUMIA`, `W`, `TUT`, `STRK`, `THETA`, `IMX`, `ZRX` |
| fields | `symbol`, `status`, `baseAsset`, `quoteAsset`, `tickSz`, `lotSz`, `pricePrecision`, `quantityPrecision`, `makerFee`, `takerFee`, `minLeverage`, `maxLeverage`, `maintMarginPercent`, `requiredMarginPercent`, `orderTypes`, `timeInForce`, `baseAssetPrecision`, `quotePrecision` |
| `data.rateLimits`, `data.exchangeFilters` | empty arrays |

Two companion calls add per pair detail, P1.

| call | reply | carries |
|---|---|---|
| `GET /api/v1/exchange/exchangeInfo` | 474 KB, 425 pairs | `fundingFeeInterval` in hours, `depthGrouping`, `liquidationFee`, `maintenanceMarginConfig`, `marginAssetsSupported`, `filters`, and `conversionRates` with `INR_MARGIN_USDT` 102 |
| `GET /api/v1/exchange/pairs` | 113 KB, 640 pairs, 425 `isActive` true and 215 false | names, the transaction `types` and the `categories` list |

Every USDT symbol is a Binance USD-M symbol: on Binance's exchangeInfo, 243 are `PERPETUAL` and 5 are `TRADIFI_PERPETUAL`, `XAUUSDT`, `XAGUSDT`, `CLUSDT`, `BZUSDT` and `NATGASUSDT`, P3.
Every INR symbol is a Binance symbol with `USDT` replaced by `INR`.
The documentation's status value is `"Open"`, S1 `market.md` line 45, which matches the wire.

### How CCXT 4.5.68 maps it

`loadMarkets` fetches spot and swap, `server/node_modules/ccxt/js/src/zebpay.js` lines 308 to 328, and returned 555 markets, 130 spot and 425 swap, in 2.6 and 3.2 s, P1.

| engine input | CCXT value | wire | verdict |
|---|---|---|---|
| `market.id` | `BTCUSDT`, from `symbol`, line 1689 | the socket's `s` and the marketInfo key are spelled the same, see [`websocket.md`](./websocket.md) section 3 | matches on 425 of 425 |
| symbol | `BTC/USDT:USDT` and `BTC/INR:INR`, lines 1694 and 1699 | | |
| `active` | `status === 'Open'`, line 1710 | `"Open"` on 425 | 425 active |
| `contractSize` | not set, so undefined | sizes are base coin | the engine's fallback of 1 at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 188 to 194 is right |
| `linear` | not set, so undefined | USDT and INR settled, linear in fact | the engine reads `false`, at line 174 |
| `settle` | not set as a field, only inside the symbol | | a `marketFilter` on `settle` would drop everything |
| `taker` | `0.06` or `0.1`, the percent field read as a fraction, line 1712 | see [`fees.md`](./fees.md) section 8 | wrong by a factor of 100 |

### Size unit, pairs listed twice, and price scale

Sizes are in the base coin, `lotSz` `0.001` on `BTCUSDT`, and the REST book sizes equal Binance's own at the same level, section 5.
A base listed in both families gives two CCXT swaps, `BTC/USDT:USDT` and `BTC/INR:INR`.
They land in different clusters, because INR is not in the quote family at [`../../../server/src/engine/cluster/quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so an INR contract would cluster with no other venue.
A `marketFilter` of `market.quote === 'USDT'` keeps the 248 USDT contracts.
Five bases carry Binance's 1000 unit prefix, `1000BONK`, `1000SATS`, `1000PEPE`, `1000FLOKI` and `1000SHIB`, spelled as Binance spells them, so no price scale is needed against Binance.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/market/marketInfo` | absent | `marketPrice` | `upcomingFundingRate` | absent | absent | 109 KB, 592 rows | median 284 and 211 ms over two runs of 60 polls, max 374 and 1,345 ms, one poll over 1 s |
| `GET /api/v1/exchange/exchangeInfo` | | | | `fundingFeeInterval`, hours | | 474 KB | 410 and 394 ms |
| socket `<pair>@markPrice`, one stream per pair | `i` | `p` | `r` | | `T`, Unix ms | 202 bytes per frame | one frame per second |

The marketInfo reply holds all 425 catalog symbols plus 167 inactive ones, P1.
Its documented fields are `lastPrice`, `marketPrice`, `priceChangePercent` and `baseAssetVolume`, S1 `market.md` lines 208 to 254, and the wire adds `upcomingFundingRate` and `quoteAssetVolume`.
No REST call returns an index or a next funding time, and none is documented.
The socket's mark stream does carry both, one pair per stream, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | marketInfo key | string, `BTCUSDT` | none |
| `index` | none in REST | | unavailable, the socket's `i` is the only source |
| `mark` | `marketPrice` | decimal string at the pair's price precision, never 0 on 592 rows | `Number()` |
| `fundingRate` | `upcomingFundingRate` | decimal string, a fraction per interval: `"0.000033372"` | `Number()` |
| `fundingIntervalHours` | `fundingFeeInterval` from exchangeInfo | integer hours: 1, 4 or 8 | none |
| `nextFundingAt` | none in REST | | unavailable, the socket's `T` is the only source |

The engine divides by the index at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 58, so a REST poller alone cannot fill a usable row.

## 4. Anchor semantics

ZebPay documents no index, mark or funding formula, S1.
The pricing page gives only "Funding Amount = Nominal Value of Position (of that contract) * Funding Rate (of that contract)", see [`fees.md`](./fees.md) section 6.
Everything below is measured against Binance USD-M in the same second, P2, P4 and P5.

### Index

The socket's `i` is Binance's index rounded up to the tick.
In the rerun, Binance's `premiumIndex` `time` equalled ZebPay's `E` on 5 of 5 reads, and `i` was Binance's `indexPrice` rounded up to 0.1 on 5 of 5, P5.

| `E` and Binance `time` | ZebPay `i` | Binance `indexPrice` | ZebPay `P` | Binance `estimatedSettlePrice` |
|---|---|---|---|---|
| 1790138456001 | `87104.8` | `87104.76978261` | `87043.5` | `87043.49355342` |
| 1790138476000 | `87144.8` | `87144.72043478` | `87046.5` | `87046.39504695` |
| 1790138486000 | `87157.9` | `87157.79847826` | `87048.1` | `87048.00505000` |

The first run read Binance about a second after ZebPay's `E` and agreed within one tick plus that second's move, P4.
ZebPay publishes no basket, and the basket behind the number is Binance's.

### Mark

`marketPrice` is Binance's `markPrice` rounded to ZebPay's price precision.
Over two runs of six reads 10 s apart, it equalled Binance's mark at ZebPay's decimals on 132 to 247 of 346 USDT rows and was within 500 ppm on 302 to 341, P2.
The two calls ran one after the other, a few hundred ms apart, and Binance's mark moves on a one second grid, so a miss is a mark that moved between the reads.
On the socket, `BTCUSDT` `p` equalled Binance's `markPrice` at the same `E` on 5 of 5 reads, for example `87052.9` against `87052.90000000`, P5.
The socket's `ap` carries Binance's unrounded mark, `87091.27697826` beside a `p` of `87091.3`, P4.
The INR mark is the USDT mark times a factor: 91.0 to 95.6, median 95.0, over 246 pairs, and 95.55 on `BTCINR`, P2 and P3.
That factor is not the `INR_MARGIN_USDT` of 102 in `conversionRates`, which is the margin conversion.
Binance's clamps are the only clamps, and ZebPay adds none it publishes.

### Funding

| item | value | evidence |
|---|---|---|
| upcoming rate | `upcomingFundingRate` in REST and `r` on the socket | P2, P4 |
| last settled rate | `lr` on the socket only | P4 |
| relation to Binance | the ratio of ZebPay's rate to Binance's `lastFundingRate` was 1.00 on 90 to 97, 1.10 on 78 to 79 and 0.90 on 69 to 73 of 332 to 333 USDT rows over two runs, the rest scattered | P2 |
| last settled | `BTCUSDT` `lr` `0.000009189` is 0.9 times Binance's 00:00 UTC settlement of `0.00001021`, and `BTCINR` `lr` `0.000011231` is 1.1 times it | P2, P4 |
| INR against USDT | the INR rate over the USDT rate of the same base was 1.000 on 149 to 150, 1.222 on 59 to 60 and 0.818 on 22 to 23 of 233 pairs, so the two families can take different factors | P2 |
| refresh | held: 7 and 9 of 592 rows changed in 59 one second intervals. `BTCUSDT` read `0.000033372` from 04:17 to 04:22, `0.000037215` from 04:27 to 04:39 and `0.000040194` at 04:41, which is 0.9 times the `0.00004466` Binance showed at 04:39:37, while Binance's moved through `0.00003954`, `0.00004326`, `0.00004466` and `0.00004421` | P2, P4, P5 |
| interval | `fundingFeeInterval` equals Binance's interval on 425 of 425 pairs, from Binance's `fundingInfo` with 8 h as its default | P2 |
| next settlement | the socket's `T` equalled Binance's `nextFundingTime`, `1790150400000`, 08:00 UTC, on every read | P4, P5 |
| cap and floor | Not publicly specified | S1 |

The scattered ratios are consistent with a factor of 0.9, 1.0 or 1.1 applied to a Binance rate that ZebPay samples and holds.
Which pairs take which factor, and when ZebPay resamples, is Not publicly specified.
The settlement instant itself was not captured, and ZebPay has no public funding history call.

### How often each number changed

Over two runs of 60 one second polls of marketInfo, P2, each cell giving both runs.

| field | rows that changed | `BTCUSDT` | `ETHUSDT` | `XAUUSDT` | `BTCINR` |
|---|---|---|---|---|---|
| `marketPrice` | 584 and 575 of 592, median 10 and 13 changes | 26 and 32 | 25 and 29 | 22 and 24 | 27 and 32 |
| `lastPrice` | 568 and 559 of 592, median 7 and 9 | 24 and 22 | 23 and 30 | 13 and 17 | 26 and 22 |
| `upcomingFundingRate` | 7 and 9 of 592, median 1 | 0 | 0 | 0 | 0 |

The socket's mark frames arrived on Binance's one second grid, `E` a median 1,000 ms apart, with 24 to 47 distinct marks in 58 to 61 frames over three runs, P4 and P5.

## 5. REST book snapshot

`GET /api/v1/market/orderBook?symbol=BTCUSDT` returns `{symbol, bids, asks, timestamp, datetime, nonce}` with up to 20 bids and 20 asks, P1.
Every USDT read held 20 a side, and `ETHINR` held 18 to 20, P3.
`limit=100`, `limit=5` and `depth=50` were ignored, 20 levels each time.
Bids are descending and asks ascending, on 60 of 60 reads over ten pairs in two runs, and levels are `[price, size]` JSON numbers, P3.
`timestamp` equals `nonce` and was 92 to 109 ms old on arrival, so it is the server's reply time, not the book's.

Each read was paired with Binance's `GET /fapi/v1/depth?limit=50` in the same instant, and every ZebPay level was matched to the Binance level of equal size on the same side, P3.
Each cell covers six reads, three per run.

| pair | tick | sizes found on Binance, bids and asks, per read | bid markdown | ask markup | ZebPay spread | Binance spread |
|---|---|---|---|---|---:|---:|
| `BTCUSDT` | 0.1 | 14 to 19 of 20 | 2 to 5 ticks | 1 to 6 ticks | 6 ppm | 1 ppm |
| `ETHUSDT` | 0.01 | 7 to 19 | 8 to 10 ticks, 29 to 36 ppm | 8 to 10 ticks | 40 to 76 ppm | 4 ppm |
| `SOLUSDT` | 0.01 | 0 to 17 | 0 ticks | 0 ticks | 84 ppm | 84 ppm |
| `DOGEUSDT` | 0.00001 | 0 to 18 | 6 ticks, 577 to 579 ppm | 6 ticks | 1,251 to 1,255 ppm | 96 to 97 ppm |
| `XAUUSDT` | 0.01 | 11 to 20 | 18 to 20 ticks | 12 to 19 ticks | 2 to 55 ppm | 2 ppm |
| `MMTUSDT` | 0.0001 | 17 to 20 | 1 tick, 575 ppm | 1 tick | 1,724 to 1,725 ppm | 575 ppm |
| `ENJUSDT` | 0.00001 | 18 to 20 | 2 ticks, 674 to 676 ppm | 2 ticks | 1,685 to 1,691 ppm | 337 to 338 ppm |
| `XRPUSDT` | 0.0001 | 0 to 5 | 2 ticks, 121 to 122 ppm, where any matched | 2 ticks | 303 to 304 ppm | 61 ppm |
| `BTCINR` | 1 | 12 to 20 | | | 13 ppm | 1 ppm |
| `ETHINR` | 1 | 5 to 14 | | | 147 to 150 ppm | 4 ppm |

The sizes are Binance's sizes, and each side sits a fixed number of ticks further from the touch than Binance's.
A read where few sizes matched is a read where Binance's book moved between the two replies.
`XRPUSDT` matched at most 5 sizes a side, so most of its sizes differ from Binance's in a way not established here.
The INR books carry the same base-coin sizes at 95.54 to 95.55 times the USDT price on `BTCINR` and 95.58 to 95.60 on `ETHINR`, and a wider spread.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| budget | "A single rate limit applies across public and private `/api` routes", tracked by client IP, with "Do not assume a 180 requests/minute budget", S1 `rate-limits.md` | headers `x-ratelimit-limit: 180`, `x-ratelimit-reset: 60` on every `/api` reply, P1 |
| remaining | | not monotonic: 177 to 179 on consecutive calls, and 165 and 159 after 60 polls in 60 s, so the counter is likely kept per backend instance, P1 and P2 |
| limit reply | HTTP 429 with the standard error body, "Please note your API request has exceeded daily limits.", and no `Retry-After`, S1 | not provoked |
| unknown pair | | 400 `{"statusDescription":"Invalid pair provided.","data":{},"statusCode":400,"customMessage":["Invalid pair provided."]}`, also for lower case `btcusdt` |
| inactive pair `AIAINR` | | 400 `"Invalid contract pair"` |
| missing `symbol` | | 400 `"Bad Request Exception"` |
| unknown pair on `tradefee` | | 500 `"Cannot read properties of undefined (reading 'takerFee')"` |
| unknown path | | 404 `{"message":"Cannot GET /api/v1/market/nope","error":"Not Found","statusCode":404}`, without rate limit headers |

## 7. Server time and clock offset

`GET /api/v1/system/time` returns `{"statusDescription":"OK","data":{"timestamp":1790137275538},"statusCode":200,"customMessage":["OK"]}` in ms.
The server clock read 5 and 6 ms ahead of this host's midpoint over 201 and 198 ms round trips, P1.
`GET /api/v1/system/status` returns `{"systemStatus":"ok"}`.

## 8. Recommended poller shape

No poller is recommended, and ZebPay is not recommended as an engine leg.

- The book, mark, index, interval and next settlement are Binance USD-M's, relayed about 230 ms late on the socket, with each side of the book moved away from Binance's touch, sections 4 and 5 and [`websocket.md`](./websocket.md) section 4.
  A cross against Binance could only come from that delay, and against any other venue ZebPay adds nothing Binance does not already give at a better price.
- The REST anchor has no index and no next funding time, and the engine divides by the index.
- ZebPay is the counterparty to every futures trade, and only residents of India may trade, see [`fees.md`](./fees.md) section 1.

If a later design wants it anyway, the smallest shape is `GET /api/v1/market/marketInfo` every second for mark and rate, keyed by symbol, with `fundingFeeInterval` from `GET /api/v1/exchange/exchangeInfo` every 60 s, rows limited to the 248 USDT pairs, and the index and next settlement taken from Binance's own anchor for the same symbol.
The 109 KB reply took at most 374 and 1,345 ms in two runs of 60 polls, and one call a second is 60 of the 180 a minute the headers state.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ZebPay API references, futures REST, commit `1be7da7` of 2026-09-19: `market.md`, `exchange.md`, `system.md`, `rate-limits.md`, `error-handling.md`, `data-models.md` | https://github.com/zebpay/zebpay-api-references/tree/main/futures/api-reference | 2026-09-22 | ZebPay | endpoints, fields, status value, rate limit rule, 429 body, sections 2 to 6 |
| S2 | CCXT 4.5.68 `zebpay.js` | `server/node_modules/ccxt/js/src/zebpay.js` | 2026-09-22 | CCXT | lines 91, 308 to 328, 1660, 1689, 1694, 1699, 1710, 1712, section 2 |
| S3 | Binance USD-M public API: `premiumIndex`, `depth`, `exchangeInfo`, `fundingInfo`, `fundingRate` | https://fapi.binance.com/fapi/v1/ | 2026-09-23 | Binance | the comparison side of sections 2 to 5 |
| P1 | `rest-probe.mjs catalog` at 04:21 and 04:38 UTC, with `dig` and `curl` at 04:12 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.mjs anchor` at 04:21 and 04:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs mirror` at 04:22 and 04:40 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zebpay/rest-probe.mjs) | 2026-09-23 | this host | sections 2 and 5 |
| P4 | `ws-probe.mjs book` at 04:24 and 04:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs) | 2026-09-23 | this host | index, mark, rate and next settlement on the socket, section 4 |
| P5 | `ws-probe.mjs book` rerun at 04:40 UTC, with Binance `premiumIndex` read beside it every 10 s | [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs) | 2026-09-23 | this host | same-instant index, mark and settle price, section 4 |
