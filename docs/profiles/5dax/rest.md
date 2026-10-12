# 5DAX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:06 to 05:30 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

5DAX lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/5dax/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S9 are those of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

### Where the API lives

The API document, S5, gives one base URL, `https://api.5dax.com/api/v1`, and 14 public GET paths in a Binance style.
The web app reads market data from undocumented paths on `https://5dax.com` itself, such as `/exchange/getProducts` and `/exchange/depth`, S2.
Only the second of those books carries an update id that lines up with the socket, see section 5.

### Access, from the Canadian VPN exit

| call | status | body or note |
|---|---|---|
| `GET https://api.5dax.com/api/v1/exchangeInfo` | 200 | the catalog |
| `GET https://api.5dax.com/api/v1/time` | 200 | `{"serverTime":...}` |
| `GET https://5dax.com/exchange/getProducts` | 200 | the app's catalog |
| `GET https://5dax.com/exchange/depth?symbol=BTCUSDT` | 200 | the app's book |
| `GET https://api.5dax.com/fapi/v1/premiumIndex` and four more perpetual paths | 404 | `"404 Not found"` |
| the same perpetual paths on `https://5dax.com` | 200 | the single page app's HTML shell, which the site serves for any unknown path |

No call was refused.
The terms bar residents of Canada and the United States from holding accounts, see [`fees.md`](./fees.md) section 1, but nothing on the wire enforces that for market data.

### Resolution

`api.5dax.com`, `5dax.com` and `socket.5dax.com` all resolved to the Cloudflare addresses `104.21.68.73` and `172.67.191.171`, and to two IPv6 addresses in `2606:4700::/32`.
Replies carried `server: cloudflare`, edge `YVR`, and `X-Powered-By: Express` from the origin.

### Latency

Three cold `GET /api/v1/time`, each on a new TLS connection, took 660, 639 and 376 ms in the first run, 420, 383 and 464 ms in the second, and 746, 380 and 654 ms in the third.
Five warm calls on one kept alive connection had a median of 360, 441 and 359 ms in the three runs.
The site's `/exchange/depth` answered in 237 to 337 ms in eight of nine calls and 768 ms in one, a little faster than the API host's book.

## 2. Catalog

### The instruments call

`GET /api/v1/exchangeInfo` returns 26,099 bytes with `timezone`, `serverTime`, `rateLimits`, `exchangeFilters` and 77 `symbols`:

```json
{"symbol":"BTCUSDT","baseAsset":"BTC","baseAssetPrecision":8,"quoteAsset":"USDT","quotePrecision":8,"status":"TRADING","icebergAllowed":true,"orderTypes":["LIMIT","MARKET"],"filters":[{"filterType":"PRICE_FILTER","minPrice":0.01,"maxPrice":0,"tickSize":0.01},{"filterType":"LOT_SIZE","minQty":1e-05,"maxQty":100000,"stepSize":1e-05}]}
```

All 77 have `status` `TRADING`.
By quote asset there are 63 USDT, 7 BTC, 6 ETH and 1 BNB pairs.
The only filters are `PRICE_FILTER` and `LOT_SIZE`, so the tick and lot size are on the wire.

The app's `GET https://5dax.com/exchange/getProducts` returns the same 77 symbols, all `active` true and `status` 0, with `productType` null on every row and `matchingUnitType` `STANDARD`.
It adds names, images, `minTrade`, the day's prices and `withdrawFee`, which is 0 on every row.

CoinMarketCap tracks 10 of the 77 pairs, S7.

### How much trades

The 24 h ticker put the 63 USDT pairs at 16,048, 16,051 and 16,048 USDT of quote volume in the three runs.
The busiest pair, BTCUSDT, traded about 2,090 USDT, which the third run's ticker gave as 0.02525 BTC.
CoinMarketCap shows about 11,590 USD of spot volume for the venue, S7.
The best levels of the BTCUSDT book held 0.00002 to 0.00029 BTC each, under 25 USDT.

### How CCXT maps it

CCXT has no 5DAX class, see [`fees.md`](./fees.md) section 8.
A hand-built catalog would use `symbol` as the market id on REST, and its lower case form as the socket namespace, see [`websocket.md`](./websocket.md) section 3.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset, and there are no contracts.
No pair is listed twice, and every symbol is its base asset followed by its quote asset.

## 3. Anchor

5DAX publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The five perpetual paths a Binance clone would expose, `/fapi/v1/exchangeInfo`, `/fapi/v1/premiumIndex`, `/api/v1/premiumIndex`, `/api/v1/fundingRate` and `/dapi/v1/exchangeInfo`, all answered 404 on the API host.
The only reference prices it publishes are its own last trade, open, high, low and `weightedAvgPrice` on `GET /api/v1/ticker/24hr`, and the same on the socket's `/miniTicker`.
None of them is an index, and none can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding to describe.

## 5. REST book snapshot

### The documented call

`GET https://api.5dax.com/api/v1/depth?symbol=BTCUSDT&limit=5` returned, in the third run:

```json
{"lastUpdateId":"6ac9ccf7c8921057cd9f5e20",
 "bids":[["82668.01","0.00014"],["82668","0.00029"],["82667.62","0.00029"],["82667.44","0.00029"],["82667.4","0.00029"]],
 "asks":[["82668.96","0.00007"],["82669.43","0.00029"],["82669.56","0.00029"],["82669.59","0.00029"],["82669.87","0.00031"]]}
```

Prices and sizes are strings, and both sides are sorted best first.
`lastUpdateId` is a 24 character hex string in the shape of a MongoDB ObjectId, whose first 8 hex digits read as a Unix second.
In the third run that second was 82 to 88 s before each of four calls, all four carried the same id, and the site's integer id did not move either, so the id seems to mark the book's last change.
It is not the socket's integer counter, so this book cannot be lined up with the socket.

### Depth limits

The document says the default is 100 and the maximum 1,000, with valid values 5 to 1,000, S5.
The wire accepts only 5, 10, 20, 50 and 100.
`limit` 1000, 7, 0 and 5000 each answered HTTP 403 with `{"code":-1100,"msg":"Illegal characters found in parameter 'limit'; legal range is '5, 10, 20, 50, 100'."}`.
With no `limit` the call returned the whole book, 29 levels a side in the first run and 70 in the second and third.
`limit` 100 returned 36 to 70 levels a side across the runs, no more than the book held.

### The app's call, which lines up with the socket

`GET https://5dax.com/exchange/depth?symbol=BTCUSDT` returns `lastUpdateId` as an integer, such as `374897182`, and levels as `[price, size, []]` with the price a JSON number and the size a string.
Both sides are sorted best first.
It ignored `limit`: no value, 100 and 1000 each returned 70 levels a side in the second and third runs.
Its `lastUpdateId` is the socket's `u`, and the socket's next `U` is that id plus one, see [`websocket.md`](./websocket.md) section 4.
This is the call the web app uses to seed its book, S2.

### Best bid and ask

`GET /api/v1/ticker/bookTicker?symbol=BTCUSDT` matched the top of the book read just after it on BTCUSDT, ETHUSDT and ETHBTC in every run.
Over all 77 symbols, 4 had a bid equal to the ask and none was crossed, in all three runs.

The 24 h ticker is not a usable top of book.
Its `bidPrice` was above its `askPrice` on 24 of 77 symbols in all three runs, and on BTCUSDT its `askPrice` stayed at 82537.5 with `askQty` 0 while the book's best ask was near 82,670.
`GET /api/v1/returnTicker` carries the same stale value as `lowsetAsk`, spelled that way.

### Unknown and odd symbols

| call | status | body |
|---|---|---|
| API `depth?symbol=NOPEUSDT` | 403 | `{"code":-1121,"msg":"Invalid symbol."}` |
| API `depth?symbol=btcusdt` | 403 | `{"code":-1100,"msg":"Illegal characters found in parameter 'symbol'; legal range is '/^[A-Z0-9_]{1,20}$/'."}` |
| API `depth?symbol=BTC_USDT` | 403 | `{"code":-1121,"msg":"Invalid symbol."}` |
| API `depth` with no symbol | 403 | `{"code":-1102,"msg":"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed."}` |
| site `exchange/depth?symbol=NOPEUSDT` | 200 | `{"lastUpdateId":0,"bids":[],"asks":[]}` |
| site `exchange/depth?symbol=btcusdt` | 200 | `{"lastUpdateId":0,"bids":[],"asks":[]}` |
| API `order_book?symbol=BTCUSDT` | 403 | `{"code":-1101,"msg":"Too many parameters; expected '2' and received '3'."}` |

The site's book answers an unknown symbol with an empty book and id 0 instead of an error, so a feed must treat id 0 as a failure.

### Caching

The API book carried a weak `ETag` and `cf-cache-status: DYNAMIC`, with no `Cache-Control`.
In the second run the `limit=100` call returned an id 16 s older than the call before it, so the API book may also be served from a short cache.

## 6. Rate limits and errors

| limit | value | source |
|---|---|---|
| document prose | "making more than 6 calls per second to the public API ... can result in your IP being banned", for 2 minutes to 1 day | S5 |
| `rateLimits` in `exchangeInfo` | `REQUEST_WEIGHT` 1,200 a minute, `ORDERS` 10 a second and 100,000 a day | probed |
| headers on the API host | `X-RateLimit-Limit: 50`, `X-RateLimit-Remaining` falling by one per call, `X-RateLimit-Reset` a Unix second about 60 s after the window's first call | probed |
| headers on the site | `X-RateLimit-Limit: 10`, with separate windows for `/exchange/getProducts` and `/exchange/depth` | probed |
| `GET /api/v1/time` | no rate limit headers | probed |

The binding limit is the header, 50 calls a minute on the API host and 10 a minute per path on the site, far below the document's 6 a second.
No call hit a limit, because the probe spaced calls 1.3 s apart, so the status and body of a refusal are not known.
Errors come as HTTP 403 with a Binance style `{"code":...,"msg":...}` body, and an unknown path is HTTP 404 with the JSON string `"404 Not found"`.
`klines` without `interval` answered `-1102`, and with `interval=9x` it answered `{"code":-1120,"msg":"Invalid interval."}`.

## 7. Server time and clock offset

`GET /api/v1/time` returns `{"serverTime":1791608824406}` in Unix ms, and `GET /api/v1/ping` returns `{}`.
Against the midpoint of each call on one connection, the server was 34.5, 16.5 and 32.5 ms ahead of the local clock at the median of the three runs, with single readings from -5 to 268 ms.

## 8. Recommended poller shape

None.
There is no anchor to poll, and 5DAX cannot be a perpetual leg.

If a later design adds spot legs, the catalog is `GET /api/v1/exchangeInfo` read once an hour, and the socket is the book feed, see [`websocket.md`](./websocket.md) section 8.
Snapshots for a resync must come from `GET https://5dax.com/exchange/depth`, not the documented API book, and its limit of 10 calls a minute per path caps resyncs across all 77 symbols at 10 a minute.

## 9. Source ledger

The sources are S1 to S9 of [`fees.md`](./fees.md) section 10.
S5 gives the documented paths, parameters and the call limit prose used here.
S2 gives the app's undocumented paths `/exchange/getProducts`, `/exchange/depth` and `/settings/getSettingByKey/wssUrl`.
