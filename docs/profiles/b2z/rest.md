# B2Z Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:40 to 05:51 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public REST API of B2Z Exchange that a catalog, an anchor poller and a book resync would use, for its one perpetual family.
B2Z publishes no API documentation of its own.
Its web app calls `api.b2z.exchange`, and that host answers every BTSE public path the [`../btse/rest.md`](../btse/rest.md) profile records, with BTSE's data.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/b2z/rest-probe.py).

## 1. Host and latency from this machine

| item | value |
|---|---|
| hosts | `api.b2z.exchange` for REST, `ws.b2z.exchange` for sockets, `www.b2z.exchange` for the web app, found in the web app bundle, which builds its clients on `${API_URL}/api`, `${API_URL}/spot/api` and `${API_URL}/futures/api` |
| addresses | `api` and `ws` resolve to the same four addresses in `143.204.1.0/24`, and `www` to four others there, in 3 to 6 ms |
| edge | Amazon CloudFront, `x-amz-cf-pop: HIO52-P5`, behind which `api` answers as `nginx` and `www` as `AmazonS3`. BTSE's own API sits behind Cloudflare, so the white label has its own front door |
| cold request | 571 and 445 ms for `GET /spot/api/v3.3/time` in two runs, including TLS |
| warm request | 146 to 428 ms over 5 time calls in each of two runs |
| refusals | none. Every public call answered 200 or a documented 400. The bare host answers the stock "Welcome to nginx!" page |

## 2. Catalog

### The instruments call

`GET https://api.b2z.exchange/public-api/market/v1/markets?types=["FuturesPerpetual"]` returned 218 rows and 110 KB in 437 and 443 ms in two runs.

| `type` | `category` | active rows |
|---|---|---:|
| `FuturesPerpetual` | `CRYPTO` | 130 |
| `FuturesPerpetual` | `STOCK` | 82 |
| `FuturesPerpetual` | `COMMODITIES` | 6 |

Every row had `active` true and `quoteCurrency` `USDT`.
`availableSettlement` lists 19 currencies on 216 rows and 17 on 2, so there is one perpetual family, multi-collateral as on BTSE.
Without the filter the call returned 1,139 rows and 414 KB: 917 `Spot`, 218 `FuturesPerpetual` and 4 `FuturesTimeBased`.
The legacy `GET /futures/api/v2.3/market_summary` returned 222 rows, the 218 perpetuals and the dated futures `BTC-270326`, `ETH-270326`, `BTC-261225` and `ETH-261225`.

### The same catalog as BTSE

The same call on `api.btse.com` in the same minute returned 219 perpetuals.
218 symbols were common, B2Z listed none that BTSE lacks, and BTSE alone listed `IOTX-PERP-USDT`.
`contractSize` and `minPriceIncrement` were equal on 218 of 218 common symbols.

### Spelling, size unit and pairs listed twice

| item | finding |
|---|---|
| `symbol` | `BTC-PERP-USDT`, equal to `tradeCurrency + '-USDT'` on 218 of 218 |
| `tradeCurrency` | `BTC-PERP`, the spelling of the socket topic, of `data.symbol` and of the legacy calls |
| `contractSize` | 0.00001 (1), 0.0001 (3), 0.001 (13), 0.01 (66), 0.1 (56), 1 (79), the same distribution BTSE's adapter loads, see [`../btse/rest.md`](../btse/rest.md) section 2 |
| BTC row | `contractSize` 0.00001, `minPriceIncrement` 0.1, `category` `CRYPTO` |
| pairs listed twice | none. Each `baseCurrency` appears once among the perpetuals |

The base renames, thousand-unit scales and denied tickers that the BTSE adapter applies hold here too, since the catalogs are the same rows.

### CCXT

No CCXT class loads B2Z, see [`fees.md`](./fees.md) section 8.

## 3. Anchor

| call | index | mark | funding rate | interval | next settlement | reply |
|---|---|---|---|---|---|---|
| `GET /futures/api/v2.3/price` | `indexPrice` | `markPrice` | absent | absent | absent | 222 rows, 19.7 KB, 162 ms |
| `GET /public-api/market/v1/ticker/24hr?types=["FuturesPerpetual"]` | absent | absent | `fundingRate` | `fundingIntervalMinutes` | `nextFundingTime`, Unix ms | 218 rows, 98.7 KB, 162 ms |
| `GET /public-api/market/v1/ticker/indices?types=["FuturesPerpetual"]` | `indexPrice` | `markPrice` | absent | absent | absent | 218 rows, 18.5 KB, 147 ms |

These are the two calls the BTSE adapter polls, and the BTSE profile shows that `ticker/indices` is a 30 s cache that must not be used, see [`../btse/rest.md`](../btse/rest.md) section 3.

### The numbers are BTSE's

Each call was read from both hosts at the same instant, in two threads.

| comparison | equal on, per read |
|---|---|
| `price` `indexPrice` | 222 of 222 common rows in two of four reads, and 117 and 154 in the other two |
| `price` `markPrice` | 222 of 222 in three of four reads, and 84 in the fourth |
| `ticker/24hr` `fundingRate` | 218 of 218 in the two reads whose output was kept |
| `ticker/24hr` `nextFundingTime` | 218 of 218 in the two reads whose output was kept |
| `ticker/24hr` `openInterest` | 218 of 218 in the two reads whose output was kept |

In the first read BTC had index 82,783.85775 and mark 82,748.5 on both hosts.
The `price` reply republishes about once a second, see [`../btse/rest.md`](../btse/rest.md) section 3, so two reads that straddle a republish differ.
In the fourth read the widest index gap was 625 ppm, and in the reads that fell on one republish it was 0.
Open interest equal on every perpetual means the positions themselves are pooled, not only the prices.

### Row mapping and freshness

The row mapping is BTSE's, see [`../btse/rest.md`](../btse/rest.md) section 3.
At 05:41 and 05:49 UTC, 151 perpetuals were on 480 minutes and 67 on 240, and all 218 read `nextFundingTime` `1791619200000`, 2026-10-10 08:00 UTC.
BTC read `fundingRate` `0.0000588` and then `0.00006088`.
No `markPrice` was 0.
Over 31 one second polls of `price`, 30 intervals, the BTC index changed 14 and 10 times in two runs and its mark 5 and 19 times, and the ETH index 20 and 26 times and its mark 28 and 24 times.
The median reply took 157 and 151 ms and the slowest 771 and 657 ms.

## 4. Anchor semantics

B2Z publishes no index, mark or funding documentation of its own.
The numbers equal BTSE's, so BTSE's formulas apply: the index is a mid of spot books on BTSE, Binance, Bitget, Bybit, Gate, MEXC and OKX, the mark is a median of three prices, and funding is the average premium plus a clamp of the interest term at ±0.05 %, see [`../btse/rest.md`](../btse/rest.md) section 4.
The published rate is the running estimate for the upcoming settlement, as on BTSE.

## 5. REST book snapshot

| call | default depth | level order | note |
|---|---|---|---|
| `GET /futures/api/v2.3/orderbook/L2?symbol=BTC-PERP` | 10 per side, about 800 bytes | bids descending, asks ascending, best first on both | `depth=100` returned 50 per side |
| `GET /public-api/market/v1/orderbook?symbol=BTC-PERP-USDT` | 10 per side, about 520 bytes | bids descending, asks descending, best ask last | |

Every reply carried `x-cache: Miss from cloudfront`, so CloudFront does not cache the book.

### The books are BTSE's

The probe read the BTC-PERP and ETH-PERP L2 books from both hosts at the same instant, five rounds each, in two runs.
In the 7 of 20 rounds where both replies carried the same `timestamp`, all 20 of 20 levels, price and size, were equal.
In the other 13 rounds the timestamps differed by 30 to 240 ms and 1 to 20 of 20 levels were equal, because the book had moved between the two reads.
The socket confirms it: both hosts serve the same `seqNum` chain, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

B2Z publishes no rate limit.
BTSE documents 50 requests per 2 s per IP on the markets API and 15 per second on the legacy futures queries, see [`../btse/rest.md`](../btse/rest.md) section 6.
Whether the B2Z front door applies the same limits is Not publicly specified.
No reply carried a rate limit header or `Retry-After`, and the probe stayed near 2 requests per second.

| request | answer |
|---|---|
| unknown symbol on `/futures/api/v2.3/orderbook/L2?symbol=NOPE-PERP` | HTTP 400, `{"status":400,"errorCode":-7006,"message":"Coin pair does not exist","extraData":null}` |
| `/futures/api/v2.3/time` | HTTP 404 with an empty body |
| a path the web app knows but the API does not serve, such as `/api/events/marketStatus` | HTTP 404 |

## 7. Server time

`GET https://api.b2z.exchange/spot/api/v3.3/time` returns `{"iso":"2026-10-10T05:50:26.501Z","epoch":1791611426}`, where `epoch` is whole seconds and `iso` carries milliseconds.
Six reads over two runs put `iso` 11 to 112 ms ahead of the local midpoint of each request, within half of round trips of 142 to 362 ms, and the host's clock was NTP synchronised.
So no clock offset is visible.

## 8. Recommended poller shape

B2Z fits only as the BTSE adapter of [`../../../server/src/venues/btse.rs`](../../../server/src/venues/btse.rs) with its hosts changed.

| item | value |
|---|---|
| REST base | `https://api.b2z.exchange` in place of `https://api.btse.com` |
| socket | `wss://ws.b2z.exchange/ws/oss/futures` in place of `wss://ws.btse.com/ws/oss/futures` |
| catalog | `MARKETS_PATH` of [`../../../server/src/venues/btse/markets.rs`](../../../server/src/venues/btse/markets.rs), unchanged |
| anchor | `PRICE_PATH` every second and `TICKER_PATH` for funding, of [`../../../server/src/venues/btse/anchor.rs`](../../../server/src/venues/btse/anchor.rs), unchanged |
| taker | 500 ppm, see [`fees.md`](./fees.md) section 9 |

That shape would add no independent price.
Every book level, index, mark, funding rate and open interest read here equals BTSE's, so a B2Z leg beside the BTSE leg would only ever show a zero spread against it.
The engine should carry one of the two.
B2Z's lower taker, 500 ppm against 550, and its open Canadian registration are the only reasons to prefer it, and neither changes what the engine observes.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://www.b2z.exchange/app.vzIDuEKr.js` and its chunk `static/js/ZwG30tV1.js` | the API client bases, the socket paths `/ws/oss/futures`, `/ws/futures`, `/ws/oss/spot`, `/ws/spot`, the fee and country calls |
| S2 | `https://api.b2z.exchange/public-api/market/v1/markets`, `/futures/api/v2.3/market_summary`, `/futures/api/v2.3/price`, `/public-api/market/v1/ticker/24hr`, `/public-api/market/v1/ticker/indices`, `/futures/api/v2.3/orderbook/L2`, `/public-api/market/v1/orderbook`, `/spot/api/v3.3/time` | every B2Z number above |
| S3 | the same paths on `https://api.btse.com` | the comparison rows |
| S4 | [`../btse/rest.md`](../btse/rest.md) | BTSE's row mapping, formulas, rate limit and the 30 s cache of `ticker/indices` |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/b2z/rest-probe.py) modes `host`, `catalog`, `anchor`, `mirror`, `poll`, `book` and `time`, first run 05:40 to 05:46 UTC and second pass 05:49 to 05:51 UTC on 2026-10-10 | every probed number |
