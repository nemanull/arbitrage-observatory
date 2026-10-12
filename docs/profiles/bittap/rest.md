# BitTap REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 02:18 to 02:44 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers BitTap's public REST surface for its one perpetual family, USDT-M linear perpetuals.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/bittap/rest-probe.py), [`anchor-probe.py`](../../../scripts/probes/venues/bittap/anchor-probe.py) or [`mark-all-probe.py`](../../../scripts/probes/venues/bittap/mark-all-probe.py) unless a source row is named.
BitTap documents its futures market data under `/fmapi/v1/` on `https://openapi.bittap.com`, S1.
The website itself calls a second, undocumented API on `https://api.bittap.com`, which carries the only complete catalog.

## 1. Host and latency from this machine

| host | role | resolved address | cold request | warm request |
|---|---|---|---|---|
| `openapi.bittap.com` | documented "API URL", serves `/fmapi/v1/` | `104.20.43.209`, `172.66.174.202`, Cloudflare | 134 to 310 ms, `GET /fmapi/v1/ping` on a new TLS connection | 110 to 139 ms |
| `api.bittap.com` | documented "Public URL", serves the website's calls and `/api/v1/ping` and `/api/v1/time` | the same two addresses | 127 to 241 ms, `GET /api/v1/ping` | 102 to 119 ms |
| `stream.bittap.com` | WebSocket | the same two addresses | see [`websocket.md`](./websocket.md) | |

Every host sits behind Cloudflare, with `CF-RAY` ending in `YVR`, the Vancouver edge.
The documented futures paths answer only on `openapi.bittap.com`.
`GET https://api.bittap.com/fmapi/v1/exchangeInfo` answered HTTP 404 `{"timestamp":"…","path":"/fmapi/v1/exchangeInfo","status":404,"error":"Not Found","requestId":"…"}`.
No call was refused from the Canadian exit, and the website's region check `GET https://api.bittap.com/ucenter/public/api/v1/compliance/check` returned `"level":0` and `"ruleCode":null`.
Canada is nevertheless a restricted region for trading, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The documented instruments call

`GET https://openapi.bittap.com/fmapi/v1/exchangeInfo`, S2, returned 316 symbols in about 321 KB in 493 to 521 ms over three runs.
Each symbol has only six fields: `symbolId`, `contractSide`, `contractType`, `defaultLeverage`, `defaultMarginMode` and `riskLimitConfigs`.
It has no status, no tick size, no contract multiplier and no `depths`, although the usage page says to "Get the depths array from exchange information", S7.
So it lists the 34 SETTLED contracts beside the 282 live ones with nothing to tell them apart.
The documented `/ftapi/v1/symbolConfig` returns the same six fields and is a trading call, S18.

### The website's catalog

`GET https://api.bittap.com/asset/public/v1/exchange/info` is the call the website makes, found in its bundle, S16.
It returned 316 `contractSymbols`, 122 `spotSymbols` and 420 `coins` in about 875 KB in 606 to 701 ms over three runs.
The 316 contract ids equal the 316 of `/fmapi/v1/exchangeInfo` exactly.
Each contract carries `symbolId`, `symbolName`, `baseCode`, `quoteCode`, `status`, `multiplier`, `priceStep`, `pricePrecision`, `quantityPrecision`, `minOrderQuantity`, `maxOrderQuantity`, `depths`, `settleCycle`, `fundRateLimit`, `indexSource`, `indexSymbolId`, `takerFeeRate`, `makerFeeRate`, `liquidationFeeRate`, `enableVipRate`, `riskLimitConfigs` and more.

| item | value |
|---|---|
| status values | `OPEN` 282, `SETTLED` 34 |
| active perpetuals by settlement asset | USDT 282 |
| `contractSide` and `contractType` | FORWARD and PERPETUAL on all 316 |
| `multiplier` | `"1"` on all 282 OPEN |
| `settleCycle`, hours | 4 on 186, 8 on 95, 1 on KAIA |
| `depths[0]` equals `priceStep` | 282 of 282 |
| `symbolName` equals `baseCode` plus `quoteCode` | 282 of 282, for example `BTCUSDT` for `BTC-USDT-M` |
| ids outside `[A-Z0-9]+-USDT-M` | `币安人生-USDT-M` and `牛来-USDT-M` |
| base listed twice | none |
| digit-leading bases | `1INCH`, `2Z` and `0G`, which are token names, not 1000x contracts |
| stock, index or metal tickers | 12, XAU, XAG, TSLA, MSTR, NVDA, COIN, CRCL, AAPL, AMZN, MSFT, GOOGL and QQQ, untagged in the catalog |

BTC-USDT-M, as the catalog states it:

```json
{"symbolId": "BTC-USDT-M", "symbolName": "BTCUSDT", "status": "OPEN", "multiplier": "1", "priceStep": "0.1", "depths": ["0.1", "1", "10", "100"], "minOrderQuantity": "0.0001", "quantityPrecision": 4, "settleCycle": 8, "fundRateLimit": "0.0005", "indexSymbolId": "BTC-USDT", "indexSource": ["BYBIT", "BITGET", "BINANCE", "OKX"], "takerFeeRate": "0.0006", "makerFeeRate": "0.0002", "liquidationFeeRate": "0.005"}
```

### How CCXT maps it

CCXT has no BitTap class, see [`fees.md`](./fees.md) section 8.
A loader outside CCXT is needed, as every Rust venue already has, for example [`gate/markets.rs`](../../../server/src/venues/gate/markets.rs).

| engine field | BitTap source |
|---|---|
| `rawMarketId` | `symbolId`, for example `BTC-USDT-M`, which is the exact spelling of the socket's `s` and the REST `symbolId` |
| `base`, `quote` | `baseCode`, `quoteCode` |
| `linear` | true, since `contractSide` is FORWARD on every contract |
| `active` | `status == "OPEN"` |
| `contractSize` | `multiplier`, 1 on every contract |

### Size unit, pairs listed twice, and price scale

Book sizes are base coin units.
In the second run, the 24 hour ticker's `amount` divided by `volume` was 82,698 on BTC against a day's range of 81,917.7 to 83,499.1, 0.0849 on DOGE against 0.08398 to 0.08637, and 0.00000392 on PEPE against 0.0000038458 to 0.0000040383.
No base appears twice, and no contract is quoted per 10 or per 1000 units.
The two Chinese-character contracts would need a check against other venues' tickers before they join a cluster.

## 3. Anchor

### The bulk calls

No REST call carries index, mark or funding, in bulk or per contract.

| call | reply |
|---|---|
| `GET /fmapi/v1/premiumIndex`, with and without `symbolId` | `{"code":"410000","data":null,"msg":"invalid.request","success":false}` |
| `GET /fmapi/v1/fundingRate?symbolId=BTC-USDT-M` | the same `410000` |
| `GET /fmapi/v1/markPrice?symbolId=BTC-USDT-M` | the same `410000` |
| `GET /fmapi/v1/indexPrice?symbolId=BTC-USDT-M` | the same `410000` |
| the website's `/mark/kline/api/v1/mark/klines` and `/index/kline/api/v1/index/klines` on `api.bittap.com` | `{"code":"410002","data":null,"msg":"invalid.api.key","success":false}` without the website's session |

The documented market data section has ping, time, exchange information, order book, trades, klines, 24 hour ticker, price ticker and book ticker, and nothing else, S1.
`410000` is also what any unknown path on `openapi.bittap.com` returns, so these calls do not exist.

The anchor is on the socket.
The documented stream is `f_markPrice@<symbolId>`, S6, and [`anchor-probe.py`](../../../scripts/probes/venues/bittap/anchor-probe.py) subscribed it for all 282 OPEN contracts on one socket, which delivered a frame for 282 of 282 within 40 s, one per contract per second, in each of two runs.
The website's bundle also names an undocumented all-market stream, `f_markPrice_all`, S16.
[`mark-all-probe.py`](../../../scripts/probes/venues/bittap/mark-all-probe.py) found it sends one frame a second, 887 to 1,119 ms apart over two 12 s runs, holding the same row for every one of the 282 OPEN contracts and 32 of the 34 SETTLED ones, about 40 KB per frame.
That one subscription is the bulk anchor, the socket equivalent of a bulk REST call.
The Rust engine already has the piece this needs, [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs), which several venues use.

### Row mapping

| `AnchorRow` column | BitTap source |
|---|---|
| `index` | `I`, "spot index price", a string |
| `mark` | `p`, a string |
| `fundingRate` | `r`, a fraction as a string, for example `"-0.00015"` |
| `fundingIntervalHours` | the catalog's `settleCycle`, since the stream has no interval |
| `nextFundingAt` | `T`, Unix ms |

## 4. Anchor semantics

### Index

The catalog names the venues behind each index in `indexSource`, and the spot pair in `indexSymbolId`, for example `BTC-USDT` from Bybit, Bitget, Binance and OKX.
Across the 282 OPEN contracts the most common sets are Binance spot and Binance futures on 97, Binance alone on 54, Binance, Bitget, Bybit and OKX on 45, Binance and Bitget on 44, and Bitget alone on 24.
The weighting and any outlier rule are Not publicly specified.
The BTC index read `82630.1428571428571429` and `82646.6642857142857143` in two runs, and both end in the repeating decimals of a seventh.
That fits a plain mean over seven inputs, but it is an observation, not a published formula.
Against Binance USD-M `indexPrice` on the 278 shared symbols, BitTap's `I` differed by a median of 232 to 242 ppm and a 90th percentile of 1,231 to 1,314 ppm over two runs.
The largest gaps were XMR at 82,993 ppm, 561.83 against 518.78, and LIT at 82,863 ppm, 3.886 against 3.588, so those two tickers may name another market or token than Binance's and need a denied-pairs check.

### Mark

The mark formula and its clamps are Not publicly specified.
BTC's mark stood 337 and 348 ppm below its index in two runs, with a funding rate of -0.00015.

### Funding

The published formula is "Funding Rate = Interest Rate + Premium Index", with no interest rate, premium sampling or clamp given, S12.
`r` changed between consecutive frames 621 times out of 10,999 and 594 out of 10,717 in two 40 s runs, while `T` never changed.
So `r` is a live estimate for the settlement at `T`, which is the upcoming rate the engine wants.
The documentation does not say this in words.
`T` sat on the UTC grid of the contract's `settleCycle` and within one cycle ahead on 282 of 282 contracts.
TRX streamed `r` of -0.00068 and -0.000689 against a `fundRateLimit` of 0.0005, so that field is not a hard cap on the published rate.
BitTap's `r` equalled Binance USD-M `lastFundingRate` on only 19 and 20 of 278 shared symbols in two runs, so the rate is computed locally rather than copied.

### Rate across a settlement

Not captured, because the survey never waits for a clock event.
The support centre states that crediting may lag the settlement by 10 to 30 seconds, S11.

### How often each number changed

Over 40 s of one frame per contract per second, in two runs:

| field | changed, run 1 of 10,999 pairs | changed, run 2 of 10,717 pairs |
|---|---|---|
| mark `p` | 1,467 | 1,301 |
| index `I` | 2,271 | 2,268 |
| funding `r` | 621 | 594 |
| next funding `T` | 0 | 0 |

The event time `E` stepped by 949 to 1,052 ms between frames of one contract, a median of 1,000.
That is fast enough for the engine's 10 s staleness limit and its 5 s pairing window.

## 5. REST book snapshot

`GET https://openapi.bittap.com/fmapi/v1/depth?symbolId=BTC-USDT-M&scale=0.1`, S3.

| item | value |
|---|---|
| required parameters | `symbolId` and `scale`. Without `scale` the reply is `{"code":"1000010","data":null,"msg":"must not be null","success":false}` |
| depth | 30 levels per side by default, with `e` `f_depth30`. `limit=5` gives 5 with `e` `f_depth5`, and `limit=100` gave 66 to 77 per side with `e` `f_depth100`. `level=50` is ignored |
| scales | each of BTC's `depths` worked, 0.1, 1 and 10 with 30 levels and 100 with 25 to 27 |
| level order | bids descending, asks ascending, prices and sizes as strings |
| sequence | `lastUpdateId`, the same counter as the socket, which advanced on every poll 0.5 s apart |
| caching | none seen, every poll returned a new `lastUpdateId` |
| time | 108 to 132 ms on a warm connection |
| unknown symbol | `{"code":"0","data":null,"msg":"system.success","success":true}` |
| SETTLED contract | a full book, as on the socket |

The book ticker `GET /fmapi/v1/ticker/bookTicker?symbolId=` needs a symbol and has no all-market form.
The same holds for `/fmapi/v1/ticker/24hr` and `/fmapi/v1/ticker/price`.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limit | "600 requests per minute. 10 requests per second." | S1 |
| rate limit headers | none on any reply | Probed |
| a reached limit | not tested, the probe stayed at 2 requests per second. HTTP 429 is documented as "Request rate limit exceeded" | S1 |
| error envelope | HTTP 200 with `{"code":"<string>","data":null,"msg":"…","success":false}` | Probed |
| codes seen | `1000010` must not be null, `100011` required parameter missing, `410000` invalid request for an unknown path, `410002` invalid API key | Probed |

## 7. Server time and clock offset

`GET https://openapi.bittap.com/fmapi/v1/time` returns `{"code":"0","data":1791599629371,…}`, and `GET https://api.bittap.com/api/v1/time` returns `{"serverTime":1791599631192}`.
Server minus local was -237 to -248 ms over both calls and both runs, so the local clock ran about 245 ms ahead.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| catalog | `GET https://api.bittap.com/asset/public/v1/exchange/info` at boot, keep `contractSymbols` with `status == "OPEN"` | the documented call has no status and lists 34 SETTLED contracts that still stream a book |
| anchor source | the first book socket also subscribes `f_markPrice_all`, and the handler writes `SocketAnchors` from each row whose `s` is tracked | no REST call carries index, mark or funding, and one stream carries all of it every second |
| `fetch_round` | return the socket rows with no request | as the other socket-anchored venues do |
| interval | `settleCycle` from the catalog, refreshed with the catalog | the stream has no interval, and the documented 8 h is stale for 187 contracts |
| row mapping | section 3 | |
| skip | the two Chinese-character contracts until a denied-pairs check, and any contract whose stream is silent 10 s after its `ACK` | section 2 and [`websocket.md`](./websocket.md) section 4 |

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | `https://developers.bittap.com/en/futures/getting-started`, last updated January 26, 2026 | 2026-10-09 | hosts, rate limit, error codes |
| S2 | `https://developers.bittap.com/en/futures/market/exchange-info`, last updated January 28, 2026 | 2026-10-09 | documented catalog |
| S3 | `https://developers.bittap.com/en/futures/market/depth`, last updated January 26, 2026 | 2026-10-09 | REST book |
| S6 | `https://developers.bittap.com/en/futures/futures-websocket/mark-price`, last updated January 26, 2026 | 2026-10-09 | anchor stream |
| S7 | `https://developers.bittap.com/en/futures/market/usage`, last updated January 26, 2026 | 2026-10-09 | depths instruction |
| S11 | `https://support.bittap.com/hc/en-us/articles/13196551712271`, updated 2026-04-15 | 2026-10-09 | funding crediting delay |
| S12 | `https://support.bittap.com/hc/en-us/articles/10736347474959`, updated 2025-06-19 | 2026-10-09 | funding formula |
| S16 | `https://www.bittap.com/assets/261009-164923376-2g/index.c47c34d0.js`, the website bundle | 2026-10-09 | the website's catalog, kline and region check calls, and the `f_markPrice_all` stream |
| S18 | `https://developers.bittap.com/en/futures/trading/symbol-config`, last updated January 28, 2026 | 2026-10-09 | symbol configuration call |

The other source rows are in [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).
