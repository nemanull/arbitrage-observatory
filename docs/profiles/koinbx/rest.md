# KoinBX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:40 to 05:40 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare `loc=CA`, colo `YVR` and `SEA`).

This profile covers the REST side of KoinBX perpetual futures.
The documented public API, S1, covers spot only: markets, currencies, tickers, order book and trades on `https://api.koinbx.com`.
The futures calls below are the ones the futures web app makes to `https://futures-api.koinbx.com/api/v1`, found in its script bundle, S2.
They answer without credentials, and none of them is documented.
Every number was read by [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs), and the anchor comparisons also by [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs).
Binance USD-M, S5, is read beside KoinBX throughout, because every KoinBX perpetual turned out to be a Binance USD-M contract.

## 1. Host and latency from this machine

| host | resolved on 2026-09-22 | edge |
|---|---|---|
| `futures-api.koinbx.com` | `172.67.214.12`, `104.21.86.18`, `2606:4700:3032::ac43:d60c`, `2606:4700:3033::6815:5612` | Cloudflare, `cdn-cgi/trace` answered `colo=YVR` and `loc=CA` in both runs |
| `api.koinbx.com` | the same four addresses | Cloudflare, `cf-ray` ending `SEA` |
| `kbx-futures-prod.webpubsub.azure.com` | `57.159.87.133`, `2603:1040:a06:3::10d` | Azure Web PubSub for Socket.IO, see [`websocket.md`](./websocket.md) section 1 |

| call | reply | cold | warm, first byte and total in ms |
|---|---|---|---|
| `GET /api/v1/market/orderBook?symbol=BTCUSDT` | 808 bytes | 271 and 300 ms | 255/256, 897/899, 258/259, 261/262, 912/913, then 267/268, 266/268, 261/261, 932/932, 284/286 |
| `GET /api/v1/market/marketInfo` | 103 KB | 4,832 and 14,761 ms, first byte at 2,204 and 2,229 ms | 274/1,808, 273/1,360, 262/1,171, 266/916, 508/2,063, then 525/14,027, 729/14,078, 455/16,385, 290/5,755, 287/11,996 |
| `GET /api/v1/exchange/exchangeInfo` | 715 KB | 45.8 s and 71.6 s, and 27.3 s by curl. A curl at 06:08 UTC stopped at its 150 s limit with 551 KB received | |
| `GET /api/v1/market/markets` | 186 KB | 14.8 s and 23.9 s | |
| spot `GET /orderbook?market_pair=BTC_USDT` | 992 bytes | 3,767 and 1,596 ms | 237 to 2,124 ms total over ten requests |

The first byte arrives in about 250 to 750 ms, and the body of every reply larger than a few KB then trickles in over seconds.
`exchangeInfo` arrived at about 10 to 26 KB per second.
The spot host shares the Cloudflare addresses but was served from the `SEA` colo while the futures host was served from `YVR`.
Neither host refused this host, and no reply carried a status other than 200 except the error cases of section 6.

## 2. Catalog

### The instruments call

| call | rows | what it adds |
|---|---|---|
| `GET /api/v1/exchange/exchangeInfo` | 558 `pairs` | `pair`, `baseAsset`, `quoteAsset`, `contractType`, `makerFee`, `takerFee`, `fundingFeeInterval` in hours, `depthGrouping`, `pricePrecision`, `quantityPrecision`, quantity and notional `filters`, `maxLeverage`, `maintenanceMarginConfig`, `liquidationFee`, `marginAssetsSupported`, plus `quoteCurrencies`, `categories` and `conversionRates` |
| `GET /api/v1/market/markets` | 558 `symbols`, all `status` `Open` | the Binance-shaped list: `symbol`, `status`, precisions, `orderTypes`, `timeInForce`, fees, leverage, and `rateLimits: []` |
| `GET /api/v1/exchange/pairs` | 558, all `isActive: true` | `marginAsset` `INR` on all 558 |

The three lists name the same 558 symbols, P1.

| family | `contractType` | active | margin |
|---|---|---:|---|
| quoted in USDT | `PERPETUAL` | 300 | INR |
| quoted in USDT | `TRADIFI_PERPETUAL` | 29 | INR |
| quoted in INR | `PERPETUAL` | 200 | INR |
| quoted in INR | `TRADIFI_PERPETUAL` | 29 | INR |

The TradFi set is stocks, metals and energy, for example `NVDAUSDT`, `TSLAUSDT`, `XAUUSDT`, `XAGUSDT`, `CLUSDT` and `NATGASUSDT`, P1.
All 329 USDT-quoted symbols are live on Binance USD-M, whose `premiumIndex` listed 909 symbols that day, and the USDT contract of every one of the 229 INR bases is too, P1.

### How a catalog would map

CCXT 4.5.68 has no KoinBX class, see [`fees.md`](./fees.md) section 8, so the engine's `loadMarkets` path at `server/src/ccxt/connector.ts` line 79 has nothing to call.
A hand-built catalog would read:

| engine field | KoinBX source | note |
|---|---|---|
| `rawMarketId` | `pair`, `BTCUSDT` | the REST book accepts it in any case. The socket topic is lowercase, `btcusdt@depth_0.1`, and the frame's `s` is `BTCUSDT` again |
| `base`, `quote` | `baseAsset`, `quoteAsset` | `quoteAsset` is `USDT` or `INR` |
| settlement | INR on every contract | the engine's quote family is USD, USDC and USDT, so no KoinBX contract settles in it |
| `contractSize` | not published | quantities are in base units, `BTCUSDT` has `LIMIT_QTY_SIZE` minimum `0.001` BTC, and the socket sizes equal Binance's coin sizes, see [`websocket.md`](./websocket.md) section 4, so 1 |
| `active` | `status` `Open` and `isActive` | all 558 |

### Size unit, pairs listed twice, and price scale

Every INR base is listed twice, once quoted in INR and once in USDT, and both books are copies of the same Binance USDT book, moved away from the touch by a different number of steps, see [`websocket.md`](./websocket.md) section 4.
No USDT base is listed twice.
Nine USDT symbols carry Binance's own scaled names: `1000PEPEUSDT`, `1000SHIBUSDT`, `1000BONKUSDT`, `1000CATUSDT`, `1000SATSUSDT`, `1000CHEEMSUSDT`, `1000FLOKIUSDT`, `1000000MOGUSDT` and `1000RATSUSDT`, P1.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/market/marketInfo` | absent | `marketPrice` | `upcomingFundingRate` | absent | absent | 103 KB, 558 rows keyed by symbol | 54 polls: min 528, median 3,091, p90 8,401, max 9,569 ms, and 6 more timed out at 10 s. Rerun: 9 polls from 7,229 to 12,878 ms, and 3 more timed out at 15 s. One call from `ws-probe.mjs` at 06:17 UTC timed out at 30 s |
| `GET /api/v1/exchange/exchangeInfo` | | | | `fundingFeeInterval`, hours | | 715 KB | 45.8 s and 71.6 s |
| socket `<symbol>@markPrice`, one topic per contract | `i` | `p` | `r` | | `T`, Unix ms | one frame a second per contract | see [`websocket.md`](./websocket.md) section 2 |

`marketInfo` also carries `lastPrice`, `priceChangePercent`, `baseAssetVolume` and `quoteAssetVolume`, and nothing else, P1.
No bulk call carries the index or the next settlement.
The bulk mark topic `!markPrice@arr` was acknowledged on the socket and sent nothing, and `GET /api/v1/market/premiumIndex` and `GET /api/v1/market/fundingRate` answered 404, P5.
The engine refuses a reading older than 10 s and legs read more than 5 s apart, at `server/src/engine/opportunity/anchorReading.ts` lines 4 and 5, and a `marketInfo` reply alone took up to 12.9 s.

### Row mapping

This mapping is recorded for completeness, and section 8 recommends against building it.

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `marketInfo` object key, or the frame's `s` | `BTCUSDT` | none |
| `index` | socket `i` only | decimal string rounded to the contract's tick | `Number()` |
| `mark` | `marketPrice`, or socket `p` | decimal string | `Number()` |
| `fundingRate` | `upcomingFundingRate`, or socket `r` | decimal string, a fraction per interval | `Number()` |
| `fundingIntervalHours` | `exchangeInfo` `fundingFeeInterval` | integer hours: 8, 4 or 1 | none |
| `nextFundingAt` | socket `T` | Unix ms | none |

## 4. Anchor semantics

### Mark

The Futures Trading Policy defines the mark as "the reference price determined by KoinBX for risk management and liquidation purposes in accordance with its internal methodology", S3.
On the wire it is Binance's mark.

- The socket's `E` equalled the `time` of Binance's `premiumIndex` on 75 of 75 `BTCUSDT` frames and 74 of 74 `ETHUSDT` and `IRYSUSDT` frames, and on every matched frame of two reruns, P7.
  It fell on a whole second on 48 to 55 of 74 to 77 frames per contract, and a few milliseconds off it on the rest, as Binance's `time` did, P7.
- `p` was within 1 ppm of Binance's `markPrice` on every `BTCUSDT` frame and within 4 ppm on every `ETHUSDT` frame, and it equalled it after rounding to KoinBX's decimals on 44 of 75 and 55 of 74, P7.
- `ap` is Binance's unrounded mark: `"ap":"86917.56476812"` beside `"p":"86917.6"`, P7.
- REST `marketPrice` read `86961.8`, `86903.7`, `86890.2`, `86748.8` and `86667.1` where Binance read `86961.75031484`, `86903.68150000`, `86890.20000000`, `86748.79455797` and `86667.10000000` in the same second, P3.
- Across all USDT contracts the REST gap to Binance's mark had a median of 78 ppm and 39 ppm in two runs, with 4,926 of 17,766 and 1,044 of 2,961 exactly equal, P3.
  The gap is the seconds between the two replies, since a `marketInfo` reply took seconds.

The mark is not clamped by anything KoinBX publishes, and Binance's own mark clamps apply.

### Index

The socket's `i` was within 1 ppm of Binance's `indexPrice` on every `BTCUSDT` frame and within 4 ppm on every `ETHUSDT` frame, P7.
On `IRYSUSDT` the gap was 204 to 270 ppm, and 46 to 628 and 63 to 326 ppm in two reruns, at most about one tick of `0.00001`, the step of KoinBX's five decimals, which is about 600 ppm of `0.0165`, P7.
The basket is therefore Binance's, and KoinBX publishes no basket call.
Binance's baskets have already produced a self-referential index once, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and a KoinBX leg would inherit every such basket.

### INR contracts

An INR contract's mark and index are Binance's USDT values times a fixed 95.55.
`BTCINR` `p` over Binance's `BTCUSDT` mark was 95.550001 to 95.550012 on 74 frames, and `ap` on `BTCINR` is the USDT mark, P7.
`BTCINR` over `BTCUSDT` `marketPrice` was 95.55 on all 54 and 9 polls of two runs, P3.
The catalog's `conversionRates` says `INR_MARGIN_USDT: 102` and `INR_SETTLEMENT_USDT: 102`, a different number, and what each rate is used for is Not publicly specified, P1.

### Funding

The rate is KoinBX's own, differs from Binance's, and changed three times between 05:02 and 05:36 UTC on `BTCUSDT`, see [`fees.md`](./fees.md) section 6.
The socket's `T` was `1790150400000`, 2026-09-23 08:00 UTC, on every frame, the same as Binance's `nextFundingTime`, P7.
The socket also carries `lr`, `0.000009189` on `BTCUSDT` on every frame, `P`, which matched Binance's `estimatedSettlePrice` after rounding on 40 of 75 `BTCUSDT` frames, and `st`, always 1.
What `lr` and `st` mean is Not publicly specified.
The settlement instant was not captured, and no funding history call exists on the futures host.

### How often each number changed

| number | source | changes |
|---|---|---|
| mark | socket, one frame a second | `BTCUSDT` changed on 47, 36 and 48 of about 75 frames in three runs, `IRYSUSDT` on 5, 4 and 4 |
| index | socket | `BTCUSDT` 46, 25 and 41 changes, `IRYSUSDT` 3, 0 and 0 |
| mark | REST, 54 polls | `BTCUSDT` 40 changes, `BTCINR` 40, median over 558 contracts 24, none unchanged |
| funding rate | REST and socket | 0 changes on any contract over 54 polls, one change on `BTCUSDT` in the first socket run, 0 in the other two |

## 5. REST book snapshot

`GET https://futures-api.koinbx.com/api/v1/market/orderBook?symbol=BTCUSDT` returns `{"statusDescription":"OK","data":{"symbol","bids","asks","timestamp","datetime","nonce"}}`, P4.

| item | value |
|---|---|
| depth | 20 bids and 20 asks on every call, and `limit=100` still returned 20 and 20, P5 |
| level order | both sides ascending by price, so the best bid is the last element and the best ask the first, 32 of 32 books in each run |
| numbers | price and size as JSON numbers, for example `[87090.1,0.638]` |
| `timestamp` and `nonce` | equal, Unix ms, and `datetime` was `null` |
| case | `symbol=btcusdt` answered the same 20 and 20 levels |
| against Binance | `BTCUSDT` best bid 0.2 below Binance's and best ask 0.2 above on 8 of 8 samples in the rerun and 5 of 8 in the first run, whose other three were read seconds apart |
| spread | KoinBX against Binance, in ppm: `BTCUSDT` 6 against 1, `ETHUSDT` 76 against 4, `DOGEUSDT` 1,260 to 1,273 against 97 to 98 |
| INR | `BTCINR` mid over Binance's `BTCUSDT` mid was 95.55 on 16 of 16 samples |
| reply | 248 to 2,134 ms over 64 calls |

The documented spot book is `GET https://api.koinbx.com/orderbook?market_pair=BTC_USDT`, which returned 20 and 20 levels with and without `depth=50`, S1 and P5.

## 6. Rate limits and errors

No limit is published for the futures host.
The spot documentation says "Rate limits may vary by endpoint and are subject to change. Check response headers for rate limit information.", S1.
No reply from either host carried a header whose name contains `rate`, `limit` or `retry`, and `markets` returns `rateLimits: []`, P1 and P5.
No 429 or 403 came back at the rates probed, at most two requests a second per host.

| request | status | body |
|---|---|---|
| futures `orderBook?symbol=NOPEUSDT` | 400 | `"400 (Bad Request)."` |
| futures `orderBook` without `symbol` | 400 | `{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"One or more validation errors occurred.","status":400,"errors":{"symbol":["The symbol field is required."]},"traceId":"00-…"}` |
| futures `ticker24Hr?symbol=NOPEUSDT` | 400 | `"400 (Bad Request)."` |
| futures `/api/v1/market/premiumIndex` or `/fundingRate` | 404 | empty |
| spot `orderbook?market_pair=NOPE_USDT` | 200 | `{"status":"0","message":"Trading pair not found"}` |
| spot `/nope` | 404 | `{"message":"Cannot GET /nope","error":"Not Found","statusCode":404}` |

A spot error arrives as HTTP 200 with `status` `"0"`, so a client has to read the body.

## 7. Server time and clock offset

`GET /api/v1/market/markets` carries `data.serverTime` in Unix ms, and no lighter time call was found.
Against the midpoint of request and response headers, the offset was +31, +2 and -5 ms in the first run and +28 and -2 ms in the rerun, with 246 to 341 ms to headers, P6.
A third rerun sample waited 4,697 ms for headers and read -2,225 ms, which measures the wait and not the clock.
The body of that call then took 4.7 to 31.3 s to arrive.

## 8. Recommended poller shape

Do not build a KoinBX anchor poller.

| reason | evidence |
|---|---|
| the mark and the index are Binance's, rounded, and the engine already polls Binance for both | section 4 |
| the only bulk call has no index and no next settlement, and it replied in 0.5 to 16.4 s with timeouts at 10 and 15 s | sections 1 and 3 |
| the index is only on the socket, one topic per contract | [`websocket.md`](./websocket.md) section 2 |
| no contract settles in the engine's USD family | section 2 |
| only Indian residents may trade | [`fees.md`](./fees.md) section 1 |

If a later design wanted KoinBX's own funding rate as information, it would read `upcomingFundingRate` from `marketInfo` no more than once a minute, since no rate changed across 54 polls.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KoinBX Public API Documentation | https://koinbx.com/publicapi | 2026-09-22 | KoinBX, India | spot REST calls, rate limit wording, sections 5 and 6 |
| S2 | KoinBX futures web app script bundle | https://koinbx.com/futures/btcusdt, scripts under `/futures/_next/static/chunks/` | 2026-09-22 | KoinBX | futures host, call paths, section 2 |
| S3 | KoinBX Futures Trading Policy | https://koinbx.com/legal?tab=terms-and-use, content in script chunk `322eb1981dc3656b.js` | 2026-09-22 | Kooz Advisors and Technologies Private Limited, India | mark price definition, section 4 |
| S4 | CCXT 4.5.68 exchange list | `server/node_modules/ccxt` | 2026-09-22 | CCXT | no class, section 2 |
| S5 | Binance USD-M public REST | https://fapi.binance.com/fapi/v1/premiumIndex and `/fapi/v1/depth` | 2026-09-22 | Binance | comparison readings, sections 2 to 5 |
| P1 | `rest-probe.mjs catalog`, at 04:58 and 05:19 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 1, 2, 4 and 6 |
| P2 | `rest-probe.mjs latency`, at 04:59 and 05:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | section 1 |
| P3 | `rest-probe.mjs anchor`, 54 polls from 05:02 UTC, an unfinished rerun from 05:26 UTC, and 9 polls from 05:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 3 and 4 |
| P4 | `rest-probe.mjs book`, at 05:00 and 05:22 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | section 5 |
| P5 | `rest-probe.mjs errors`, at 05:01 and 05:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 3, 5 and 6 |
| P6 | `rest-probe.mjs time`, at 05:01 and 05:24 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinbx/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | section 7 |
| P7 | `ws-probe.mjs book`, at 05:09, 05:14 and 05:16 UTC, the last with Binance `premiumIndex` polled each second, and reruns at 06:11 and 06:22 UTC that polled it too | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-22 | this host, Canadian exit | section 4 |
