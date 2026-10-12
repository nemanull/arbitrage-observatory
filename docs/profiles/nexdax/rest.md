# NexDAX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:53 to 04:12 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

NexDAX lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers its spot market, as change 1 of the survey plan's template asks.
NexDAX publishes no API documentation that is readable from this host, so every call here was found by probing.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/nexdax/rest-probe.py), which sends about 40 requests per run.
The probe ran three times, and where the runs differ the range is given.

## 1. Host and latency from this machine

- `api.nexdax.com` resolves to the Cloudflare addresses `104.21.47.227` and `172.67.173.209`, and two IPv6 addresses, in `rest-probe.py` section 1.
  Replies carry `server: cloudflare`, `x-powered-by: Express` and a `cf-ray` ending in `YVR`, the Vancouver edge.
- The root `https://api.nexdax.com/` answers `200` with the page "WELCOME TO NexDAX API" and nothing else.
- Unlike `nexdax.com`, the API host is not geoblocked from this exit.
- `GET /api/v1/time` took 376 to 680 ms cold and a median of 382 to 525 ms warm over three runs.
- `GET /api/v1/ping` answers `200` with `{}`.

## 2. Catalog

- The API copies the Binance spot API shape under `/api/v1/`.
  `exchangeInfo`, `depth`, `trades`, `historicalTrades`, `aggTrades`, `klines`, `ticker/24hr`, `ticker/price` and `ticker/bookTicker` all answer, and `/fapi/`, `/dapi/`, `/sapi/` and `/api/v3/` paths answer `404`.
  The calls other than those in `rest-probe.py` were checked by hand on 2026-10-10.
- `GET /api/v1/exchangeInfo` returns 94,604 bytes in 1.6 to 4.7 s, with 283 symbols, all `status` `TRADING`, in section 2.
- Quote assets are USDT 203, BTC 35, ETH 34, NT 9 and BNB 2.
- Each row has `symbol`, `baseAsset`, `quoteAsset`, `baseAssetPrecision`, `quotePrecision`, `status`, `icebergAllowed`, `orderTypes` and two filters, `PRICE_FILTER` and `LOT_SIZE`.
  `BTCUSDT` has `tickSize` 0.01, `minQty` 1e-05 and `stepSize` 1e-05.
- `symbol` is always `baseAsset` followed by `quoteAsset`, such as `BTCUSDT`, on 283 of 283 rows.
  No symbol and no pair is listed twice.
- `TRADING` does not mean the book is live.
  `ticker/bookTicker` returned 283 rows, of which 122 or 123 were two-sided over three runs, and 73 were one-sided in each of the two runs that counted them.
  `BTCUSDT` itself was one-sided, with `bidPrice` `0`, in the first run.
  2, 0 and 1 rows had the bid at or above the ask.
  The one in the third run, `QNTUSDT`, had an uncrossed `depth` book a few seconds later, so `bookTicker` can disagree with `depth`.
- `ticker/24hr` returns 286 rows, 3 more than the catalog, all of them catalog symbols.
  Its `bidPrice` and `askPrice` are not a quote.
  On `BTCUSDT` they read 85523.86 and 61411.64 with both quantities 0, while the last price was about 82,600, and 74 rows had the bid above the ask in every run.
  115 rows had a non-zero 24 h `quoteVolume`.
- CoinMarketCap tracks 105 spot pairs and 0 perpetual and 0 futures pairs, S1.
- There is no CCXT class, see [`fees.md`](./fees.md) section 8, so there is no `market.id`, `contractSize` or `linear` to compare.
  Book sizes are in the base asset, see section 5, which is what a spot market with contract size 1 would describe.

## 3. Anchor

NexDAX publishes no index, no mark price and no funding rate, because it lists no perpetuals.
`/fapi/v1/premiumIndex` and `/api/v1/premiumIndex` answer `404`, in section 3.
The only reference prices are `ticker/price`, the last trade per symbol, and the `lastPrice` of `ticker/24hr`.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, as section 3 says.

## 5. REST book snapshot

- `GET /api/v1/depth?symbol=BTCUSDT&limit=N` returns `{"lastUpdateId":...,"bids":[[price,qty],...],"asks":[...]}`, in section 5.
- `limit` accepts 5, 10, 20, 50 and 100.
  Other values answer `403` with `{"code":-1100,"msg":"Illegal characters found in parameter 'limit'; legal range is '5, 10, 20, 50, 100'."}`.
- The book is shallow and its depth changes from minute to minute.
  At `limit=100` `BTCUSDT` returned 11 bids and 9 asks, then 70 and 69, then 11 and 69 over the three runs.
  With no `limit` it returned 9 and 7, then 70 and 69, then 19 and 69, so the default is at most 100 levels and the side counts change between two calls a second apart.
- Bids are in descending and asks in ascending price order on every reply.
- Prices and sizes are decimal strings, and sizes are in the base asset, such as `["82699.58","0.4982"]`.
- Replies carry `cf-cache-status: DYNAMIC` and no `cache-control`.
- `lastUpdateId` is a 24 hex digit string, a MongoDB ObjectId whose first 8 digits are the unix second it was made.
  It is not a sequence.
  Over 10 polls 1 s apart it took 10, 5 and 8 distinct values in the three runs, while the top of book took 1, 7 and 2.
  In the second run it went backwards 2 times and alternated between two generator prefixes, `6701f58235` and `4d71c3822f`.
  That fits two back ends that each stamp their own snapshot.
- Snapshots can be stale.
  The third run's `HOMEUSDT` reply carried the same `lastUpdateId`, `6ac9b8f56701f58235a1dd2d`, and the same ten levels as the first run's, and that id's timestamp is 1791604981, about 6.4 minutes before the request.
  The third run's first `BTCUSDT` poll carried an id 12 s older than the local clock.
- A quiet pair such as `HOMEUSDT` returns a normal 5 level book.

## 6. Rate limits and errors

- `exchangeInfo` publishes Binance's numbers, `REQUEST_WEIGHT` 1200 per minute and `ORDERS` 10 per second and 100,000 per day.
- The headers say otherwise.
  `exchangeInfo`, `depth` and the tickers carry `x-ratelimit-limit: 50`, `x-ratelimit-remaining` and `x-ratelimit-reset`, a unix second 61 s after the server time, in section 2.
  `/api/v1/time` carries none of them.
  A run of about 40 requests left `x-ratelimit-remaining` at 27 or 28, so not every call counts against the 50.
- No `429` was seen, and no `Retry-After` header.
- Errors use Binance's shape and codes with status `403`.
  An unknown symbol gives `{"code":-1121,"msg":"Invalid symbol."}`, and `BTC_USDT` is unknown.
  A missing symbol gives code `-1102`.
- An unknown path gives `404` with the JSON string `"404 Not found"`.

## 7. Server time

`GET /api/v1/time` returns `{"serverTime":1791605207784}`, in ms.
The server clock ran 66 to 174 ms ahead of the local midpoint, as the median of each of three runs.

## 8. Recommended poller shape

No anchor poller, because there is no index, mark or funding.
A future spot leg could take its catalog from `exchangeInfo`, filtered by a live two-sided `ticker/bookTicker`, because `status` is `TRADING` on every row.
Its book could only come from polling `depth` at `limit=100`, within 50 requests per window, until a socket event is known, see [`websocket.md`](./websocket.md) section 8.
The poller should ignore `lastUpdateId` and the quote fields of `ticker/24hr`.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=nexdax` with `category` spot, perpetual and futures | 2026-10-10 UTC, in `rest-probe.py` |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/nexdax/rest-probe.py) | 2026-10-10 UTC |
